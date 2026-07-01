import { similarity } from '@tokentama/scoring-engine';
import type { TrainingPair } from '../data/corpusStore';

/**
 * Retrieve the most relevant past (original → lean) rewrites from the corpus to
 * use as few-shot examples — favouring prompts similar to the target and, softly,
 * the same model. This is what makes rewrites match the user's own style.
 * Pure and deterministic.
 */
export function retrievePairs(
  pairs: TrainingPair[],
  prompt: string,
  opts: { k?: number; model?: string } = {},
): TrainingPair[] {
  const k = opts.k ?? 3;
  return pairs
    .map((p) => {
      let score = similarity(prompt, p.input);
      if (opts.model && p.model && p.model === opts.model) score += 0.15;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, k))
    .map((x) => x.p);
}

/** Build the system + user messages for a few-shot, style-matched rewrite. */
export function buildRewriteMessages(
  prompt: string,
  examples: TrainingPair[],
  portfolio?: string,
): { system: string; user: string } {
  const base =
    'You rewrite a developer\'s prompt so the model gets it right on the FIRST try while ' +
    'spending the fewest TOTAL tokens across the whole interaction. Two moves:\n' +
    '1) If the prompt is padded, polite, or repeats context, cut the filler and reference ' +
    'context by name instead of re-pasting it.\n' +
    '2) If the prompt is VAGUE, ADD the missing specifics — the exact file/function/component, ' +
    'the expected output format, and key constraints — so it does not trigger retries. A slightly ' +
    'longer but specific prompt beats a short vague one that gets re-asked.\n' +
    'Preserve the user\'s intent and personal style; never invent requirements you cannot infer. ' +
    'Return ONLY the rewritten prompt as plain text — no preamble, quotes, code fences, or explanation.';
  // The compact profile replaces stuffing many examples — cheaper and personalized.
  const system = portfolio ? `${base}\n\n${portfolio}` : base;
  const shots = examples
    .slice(0, 2)
    .map((e) => `Original:\n${e.input}\nLeaner rewrite:\n${e.output}`)
    .join('\n\n');
  const user =
    (shots ? `Examples of how I like my prompts rewritten:\n\n${shots}\n\n` : '') +
    `Rewrite this prompt in the same style:\n\nOriginal:\n${prompt}\nLeaner rewrite:`;
  return { system, user };
}
