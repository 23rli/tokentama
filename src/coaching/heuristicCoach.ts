import type { TipRequest, TipResponse, WasteCategory } from '@tokentama/shared-types';
import { splitSentences } from '@tokentama/scoring-engine';

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

// Politeness / hedging padding stripped from the rewrite so the real ask stands out.
const FILLER_PATTERN =
  /\b(?:could you please|can you please|would you please|could you|can you|would you mind|if it'?s not too much trouble|if it is not too much trouble|if you (?:could|can|don'?t mind)|if possible|i was wondering if|i(?:'d| would) (?:really |just )?(?:appreciate|like|love)(?: it| this)?(?: if)?|when you (?:get a chance|have (?:a )?(?:moment|minute|sec|time))|whenever you (?:can|get a chance)|no rush|feel free to|thank you(?: so much| very much| a lot| in advance)?|thanks(?: so much| a lot| a ton| in advance)?|much appreciated|i (?:really )?appreciate(?: it| this)?|cheers|kindly|maybe|possibly|kind of|sort of|the usual stuff|please|pls|plz)\b[.,!]*/gi;

function dedupeSentences(text: string): string {
  const seen = new Set<string>();
  return splitSentences(text)
    .filter((s) => {
      const key = s.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(' ');
}

/**
 * Cleaning-only lean rewrite: dedupe sentences, strip retry + politeness padding,
 * tidy punctuation. Produces the shortest faithful version of the prompt WITHOUT
 * appending any coaching guidance — so it's always leaner. Used by the auto-rewriter.
 */
export function leanRewrite(promptText: string): string {
  // Strip filler per sentence and drop sentences that become empty (e.g. "Thanks!").
  const sentences = splitSentences(dedupeSentences(promptText));
  const cleaned = sentences
    .map((s) =>
      s
        .replace(RETRY_FILLER, '')
        .replace(FILLER_PATTERN, '')
        .replace(/^(?:and|also|so|well|um|ok|okay|hi|hey|hello)[,\s]+/i, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([.,!?;:])/g, '$1')
        .replace(/^[\s,;:.!?-]+/, '')
        .trim(),
    )
    .filter((s) => s.replace(/[^a-z0-9]/gi, '').length >= 2);

  let core = cleaned.join(' ').replace(/\s{2,}/g, ' ').trim();
  if (!core || core.replace(/[^a-z0-9]/gi, '').length < 3) {
    core = 'State the exact task and the target (file / function / component)';
  }
  core = core.charAt(0).toUpperCase() + core.slice(1);
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
