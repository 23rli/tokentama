import type { TipRequest, TipResponse, WasteCategory } from '@tokentama/shared-types';
import { similarity, splitSentences, tokenizeWords } from '@tokentama/scoring-engine';

/** Playful one-liners per dominant waste category (design doc §11.3 tone). */
const SHORT_TIPS: Record<WasteCategory, string> = {
  redundantContext:
    'You re-pasted earlier context — point to it by name instead and save those tokens.',
  vagueness: 'Add a target and an output format so the first answer lands — fewer retries.',
  retryLoop: "Don't resend — say what was wrong and the one change you need.",
  toolOveruse: 'This can likely be done with fewer tool calls.',
  verbosityMismatch: 'Trim the filler and bound the output — same result, far fewer tokens.',
  ignoredCoaching: 'Try the rewrite below — it usually cuts tokens noticeably.',
};

const RETRY_FILLER =
  /\b(still not working|still broken|try again|same as before|just fix it|fix it)\b[.,!]?/gi;

// Politeness that forms a whole LEADING clause ("Could you please, ").
const LEAD_POLITE =
  /^(?:could you please|can you please|would you please|could you|can you|would you mind|i was wondering if you could|i wonder if you could|when you (?:get a chance|have (?:a )?(?:moment|minute|sec|time))|whenever you (?:can|get a chance)|please|pls|plz|kindly)\b[\s,]*/i;

// Politeness that forms a whole TRAILING clause ("…, thanks so much!").
const TRAIL_POLITE =
  /[\s,;-]*(?:please|kindly|thank you(?: so much| very much| a lot| in advance)?|thanks(?: so much| a lot| a ton| in advance)?|thx|i(?:'d| would)?\s*(?:really\s*)?appreciate(?: it| this)?(?: if)?|much appreciated|cheers|no rush|if possible|if (?:that|it) makes sense|if it'?s not too much trouble|if you don'?t mind)[.!?,\s]*$/i;

// A friendly greeting opener ("Hi there, ", "Hello team — ", "Hey! ").
const GREETING =
  /^(?:hi|hey|hello|greetings|good (?:morning|afternoon|evening)|dear)\b[\s,!.-]*(?:there|all|team|everyone|folks)?[\s,!.-]*/i;

// Discourse fillers safe to drop from the START of a sentence.
const LEAD_FILLER = /^(?:so|well|basically|okay|ok|now|right|um|uh|and|also)\b[\s,]+/i;

// Hedges/politeness safe to remove mid-sentence without breaking the ask.
const INLINE_POLITE =
  /\b(?:if it'?s not too much trouble|if it is not too much trouble|if you don'?t mind|if possible|no rush|feel free to|please|kindly)\b[,]?/gi;
const HEDGES =
  /\b(?:you know|basically|kind of|kinda|sort of|sorta|a little bit|a bit|i guess|i mean|some sort of|some kind of|maybe|perhaps|possibly)\b[,]?/gi;

// A marker that signals the sentence restates earlier context.
const RESTATE =
  /^(?:again|as (?:i|mentioned)|to reiterate|just to (?:repeat|reiterate)|like i said|as i said|repeating|to recap)\b[,\s]*/i;

// Function words + politeness that don't count as the "content" of an ask.
const STOP = new Set(
  (
    'a an the and or but nor for yet so of to in into on onto at by from with about over under as ' +
    'is are was were be been being am do does did done doing can could would should will shall may might must ' +
    'i you we they he she it me my mine your yours our ours their them us him her his its ' +
    'just really very much quite rather somewhat kind sort also then here there this that these those ' +
    'please kindly thanks thank thankyou thx appreciate appreciated cheers grateful help out ' +
    'thing things something anything stuff make made get got'
  ).split(' '),
);

/** Words in a sentence that carry actual meaning (not stopwords/politeness). */
function contentWords(text: string): string[] {
  return tokenizeWords(text).filter((w) => !STOP.has(w));
}

/** A sentence that is essentially a greeting or gratitude with no real ask. */
function isFillerOnly(raw: string, cleaned: string): boolean {
  const count = contentWords(cleaned).length;
  if (count < 2) return true;
  const gratitude = /\b(?:thanks?|thank you|thx|appreciate|grateful|cheers)\b/i.test(raw);
  return gratitude && count < 4;
}

/**
 * Cleaning-only lean rewrite: drop greeting/gratitude and re-pasted (duplicate or
 * near-duplicate) sentences, strip retry + politeness padding and safe hedges, tidy
 * punctuation. Produces the shortest FAITHFUL version of the prompt with no added
 * guidance — so it stays grammatical and is always leaner. Used by the auto-rewriter.
 */
export function leanRewrite(promptText: string): string {
  const kept: string[] = [];
  for (const raw of splitSentences(promptText)) {
    let s = raw
      .replace(RETRY_FILLER, '')
      .replace(GREETING, '')
      .replace(LEAD_FILLER, '')
      .replace(LEAD_POLITE, '')
      .replace(TRAIL_POLITE, '')
      .replace(INLINE_POLITE, '')
      .replace(HEDGES, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,!?;:])/g, '$1')
      .replace(/^[\s,;:.!?-]+/, '')
      .trim();
    if (!s || isFillerOnly(raw, s)) continue;

    // Explicit restatement ("Again, …") that echoes earlier content → drop it;
    // otherwise strip only the marker and keep the (genuinely new) content.
    if (RESTATE.test(raw)) {
      if (kept.length && similarity(kept.join(' '), s) >= 0.25) continue;
      s = s.replace(RESTATE, '').trim();
      if (!s) continue;
    }
    // Skip exact / near-duplicate re-pastes of something already kept.
    if (kept.some((k) => similarity(k, s) >= 0.6)) continue;

    kept.push(s.charAt(0).toUpperCase() + s.slice(1));
  }

  let core = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  if (!core || core.replace(/[^a-z0-9]/gi, '').length < 3) {
    core = 'State the exact task and the target (file / function / component)';
  }
  if (!/[.!?]$/.test(core)) core += '.';
  return core;
}

/** Build a cleaned, structured rewrite of a wasteful prompt — no LLM required. */
export function heuristicRewrite(promptText: string, categories: WasteCategory[]): string {
  // 1) Clean: drop duplicate sentences, strip retry + politeness padding.
  const core = leanRewrite(promptText);

  // 2) Add only the lines that address the detected issues — concrete, not generic.
  const set = new Set(categories);
  const lines = [core];
  if (set.has('vagueness')) {
    lines.push('Target: name the exact file / function / component to change.');
  }
  if (set.has('vagueness') || set.has('verbosityMismatch')) {
    lines.push('Output: the smallest useful format (a unified diff, one function, or 5 bullets).');
  }
  if (set.has('verbosityMismatch')) {
    lines.push('Limit: be brief — no preamble, no restating the question.');
  }
  if (set.has('redundantContext')) {
    lines.push('Context: reference earlier messages/files by name instead of pasting them again.');
  }
  if (set.has('retryLoop')) {
    lines.push('Since last try: state what was wrong and the one specific change you need.');
  }
  return lines.join('\n');
}

/** Deterministic coach used offline and as the fallback when no LLM is configured. */
export function heuristicGenerateTip(req: TipRequest): TipResponse {
  const categories = req.wasteCategories;
  const dominant = categories[0];

  const shortTip = dominant
    ? SHORT_TIPS[dominant]
    : 'Nice — that was an efficient, well-structured prompt.';
  const detailedTip = req.improvements.length
    ? req.improvements.join(' ')
    : 'Clear task, good structure, minimal waste. Keep it up.';

  const rewrittenPrompt = categories.length
    ? heuristicRewrite(req.promptText, categories)
    : undefined;

  const reductionBase = Math.max(0, 100 - req.overallScore);
  const estimatedSavings = categories.length
    ? {
        estimatedTokenReductionPct: Math.min(60, Math.max(5, Math.round(reductionBase * 0.5))),
        estimatedLatencyReductionPct: Math.min(50, Math.max(3, Math.round(reductionBase * 0.35))),
      }
    : undefined;

  return { shortTip, detailedTip, rewrittenPrompt, estimatedSavings, source: 'heuristic' };
}
