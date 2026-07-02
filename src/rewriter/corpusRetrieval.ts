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
    "You rewrite a developer's prompt into a SHORTER, self-contained prompt they can paste " +
    'directly into Copilot to get the SAME result.\n' +
    '- KEEP every concrete detail the user gave: file/function/component names, requirements, ' +
    'constraints, and the key facts from any context they pasted.\n' +
    '- CUT filler, politeness, hedging, and repetition. Use the FEWEST tokens that still works.\n' +
    '- Only ADD a missing specific if the prompt is otherwise unactionable, and keep it minimal.\n' +
    '- Do NOT give advice, options, notes, or explanations. Output ONLY the rewritten prompt text ' +
    'the user can paste \u2014 no preamble, quotes, or code fences.';
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
