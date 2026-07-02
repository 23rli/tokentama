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
    "You rewrite a developer's rough prompt into a clear, specific, self-contained prompt " +
    'that gets the RIGHT result on the first try.\n' +
    '- Preserve their intent and every concrete detail they gave (file/function/component ' +
    'names, requirements, constraints, and any facts they pasted). Never drop information.\n' +
    '- Make it unambiguous and actionable: state the goal, the target, and the expected output ' +
    'plainly. Fixing the ask matters more than making it short.\n' +
    '- Cut filler, politeness, and repetition, but never at the cost of clarity.\n' +
    "- NEVER invent specifics they didn't give (no made-up file names, APIs, or requirements). " +
    'If a detail is genuinely missing, phrase the prompt so the model asks for or handles it.\n' +
    '- Output ONLY the rewritten prompt \u2014 no advice, options, notes, preamble, quotes, or code fences.';
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
