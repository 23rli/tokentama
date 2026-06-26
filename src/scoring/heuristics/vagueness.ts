import type { Detector, DetectorInput, DetectorResult } from './types';
import { tokenizeWords, clamp01, ramp } from '../text/similarity';

const VAGUE_PHRASES = [
  'do this',
  'do that',
  'fix it',
  'fix this',
  'make it better',
  'make it work',
  'help me with this',
  'as you see fit',
  'you know what i mean',
  'the thing',
  'and so on',
  'whatever',
  'something like that',
];

const DELIVERABLE_WORDS = [
  'list',
  'bullet',
  'bullets',
  'table',
  'summary',
  'summarize',
  'json',
  'csv',
  'function',
  'class',
  'diff',
  'patch',
  'steps',
  'outline',
  'paragraph',
  'sentence',
  'words',
  'format',
  'example',
];

const TASK_VERB =
  /\b(write|create|summar|explain|fix|refactor|generate|list|build|design|analyze|review|compare|translate|implement|add|remove|update|debug|optimize|document|test)\w*/i;

/** Underspecified prompts likely to trigger clarification loops. */
export const vaguenessDetector: Detector = {
  category: 'vagueness',
  detect(input: DetectorInput): DetectorResult {
    const text = input.promptText;
    const lower = text.toLowerCase();
    const tokens = tokenizeWords(text);
    const length = tokens.length;
    const triggers: string[] = [];

    // Smooth length penalty: 0 at >=16 words, ramping to 0.45 at <=3 words, so
    // near-identical prompts get near-identical scores (no threshold cliffs).
    const lengthPenalty = ramp(16 - length, 0, 13) * 0.45;
    if (length <= 8) triggers.push('very short');

    const hitPhrases = VAGUE_PHRASES.filter((p) => lower.includes(p));
    const vaguePenalty = Math.min(0.4, hitPhrases.length * 0.2);
    if (hitPhrases.length) triggers.push(`vague wording ("${hitPhrases.slice(0, 2).join('", "')}")`);

    const hasDeliverable = DELIVERABLE_WORDS.some((w) => lower.includes(w));
    if (!hasDeliverable) triggers.push('no output format');

    const pronouns = (lower.match(/\b(it|this|that|those|these|them)\b/g) ?? []).length;
    const pronounRatio = length > 0 ? pronouns / length : 0;
    const pronounPenalty = ramp(pronounRatio, 0.1, 0.3) * 0.18;
    if (pronounRatio > 0.18) triggers.push('refers to "it/this" without naming a target');

    const hasVerb = TASK_VERB.test(text);
    if (!hasVerb) triggers.push('no clear task verb');

    const severity = clamp01(
      lengthPenalty +
        vaguePenalty +
        (hasDeliverable ? 0 : 0.18) +
        pronounPenalty +
        (hasVerb ? 0 : 0.18),
    );

    return {
      category: 'vagueness',
      severity,
      reason: severity > 0.25 ? `Underspecified: ${triggers.slice(0, 3).join(', ')}.` : undefined,
      improvement:
        severity > 0.25
          ? 'Name the target and the output format, e.g. "summarize <file> in 5 bullets".'
          : undefined,
    };
  },
};
