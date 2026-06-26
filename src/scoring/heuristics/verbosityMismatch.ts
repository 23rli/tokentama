import type { Detector, DetectorInput, DetectorResult } from './types';
import { tokenizeWords, clamp01, ramp } from '../text/similarity';
import { estimateTokens } from '../models/tokenizer';

// Politeness / hedging / padding that inflates a prompt without adding signal.
// Multi-word phrases only, to avoid false positives on common single words.
const FILLER_PHRASES = [
  'could you please',
  'if it is not too much trouble',
  "if it's not too much trouble",
  'if it is possible',
  'if possible',
  'i was wondering if',
  'i would really appreciate',
  'i would like you to',
  'i would be grateful',
  'would you mind',
  'when you get a chance',
  'as i mentioned earlier',
  'like i said',
  'you know what i mean',
  'kind of',
  'sort of',
  'maybe possibly',
  'thanks in advance',
  'the usual stuff',
  'and so on',
  'again and again',
  'as much detail as possible',
  'kindly',
];

// Cues that explicitly ask for a large answer.
const VERBOSE_CUES = [
  'in detail',
  'comprehensive',
  'exhaustive',
  'as much as possible',
  'everything you',
  'thorough',
  'very long',
  'extensive',
  'deep dive',
  'leave nothing out',
  'all the details',
];

/**
 * Over-long / padded prompts. The primary signal is PROMPT-INTRINSIC (filler,
 * padding, unbounded asks) so the same prompt always scores the same; the
 * response-size mismatch is only a small secondary nudge, never the main driver.
 */
export const verbosityMismatchDetector: Detector = {
  category: 'verbosityMismatch',
  detect(input: DetectorInput): DetectorResult {
    const { promptText, responseText } = input;
    const lower = promptText.toLowerCase();
    const promptLen = tokenizeWords(promptText).length;
    const triggers: string[] = [];

    const constrained =
      /\b\d+\s*(words|bullets|sentences|lines|points|items)\b/i.test(promptText) ||
      /\b(brief|concise|short|tl;dr|one line|one sentence)\b/i.test(lower);

    // 1) Padding / politeness filler (deterministic, prompt-only).
    const fillerHits = FILLER_PHRASES.filter((p) => lower.includes(p));
    const fillerPenalty = clamp01(fillerHits.length / 4) * 0.5;
    if (fillerHits.length) triggers.push(`padding ("${fillerHits.slice(0, 2).join('", "')}")`);

    // 2) Explicit "give me everything" cues.
    const cueHits = VERBOSE_CUES.filter((c) => lower.includes(c));
    const cuePenalty = Math.min(0.4, cueHits.length * 0.2);
    if (cueHits.length) triggers.push('asks for an exhaustive answer');

    // 3) Long prompt with no size bound — invites over-generation.
    const unboundedLong = constrained ? 0 : ramp(promptLen, 60, 200) * 0.4;
    if (unboundedLong > 0.1) triggers.push('long and unbounded');

    // 4) Secondary: the response ran much larger than a tiny prompt implied.
    const respTokens = estimateTokens(responseText);
    const responseMismatch =
      promptLen <= 25 && respTokens > 600 ? ramp(respTokens, 600, 2400) * 0.2 : 0;

    let severity = clamp01(fillerPenalty + cuePenalty + unboundedLong + responseMismatch);
    if (constrained) severity *= 0.5;

    return {
      category: 'verbosityMismatch',
      severity,
      reason:
        severity > 0.25 && triggers.length
          ? `Bloated prompt: ${triggers.slice(0, 2).join(', ')}.`
          : undefined,
      improvement:
        severity > 0.25
          ? 'Cut the filler and bound the output (e.g. "in 5 bullets" or "max 150 words").'
          : undefined,
    };
  },
};
