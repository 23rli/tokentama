/**
 * Cheap, deterministic task-difficulty estimate from the prompt text.
 *
 * Used to right-size the model and reasoning effort: trivial/moderate tasks don't
 * need a premium model or high thinking effort. It only ever informs a DOWN-route
 * recommendation (never an upgrade), so a misclassification can waste a little but
 * never silently degrades a hard task — the user always keeps escalation.
 */
export type Difficulty = 'trivial' | 'moderate' | 'complex';

export interface DifficultyResult {
  level: Difficulty;
  reasons: string[];
}

const TRIVIAL_CUES =
  /\b(rename|reformat|format|indent|lint|prettier|add (a |an )?(comment|import|type|jsdoc|docstring|test|log|logging)|fix (a )?typo|typo|spelling|rename (the )?(variable|function|file))\b/i;

const COMPLEX_CUES =
  /\b(architect|architecture|redesign|design|refactor|migrat|debug|investigate|root ?cause|diagnos|optimi[sz]e|performance|concurren|race condition|deadlock|across (multiple )?files|end-to-end|system|trade-?off|scalab|security|threat|why (is|does|are)|figure out)\b/i;

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

export function classifyDifficulty(promptText: string): DifficultyResult {
  const text = promptText.trim();
  if (!text) return { level: 'moderate', reasons: [] };

  const words = text.split(/\s+/).length;
  const multiAsk =
    countMatches(text, /\band\b/gi) + countMatches(text, /\n/g) + countMatches(text, /\?/g);
  const complex = COMPLEX_CUES.test(text);
  const trivial = TRIVIAL_CUES.test(text);

  const reasons: string[] = [];
  if (complex || words > 60 || multiAsk >= 3) {
    if (complex) reasons.push('mentions design/refactor/debug/performance');
    if (words > 60) reasons.push('long, multi-part request');
    if (multiAsk >= 3) reasons.push('several asks in one prompt');
    return { level: 'complex', reasons };
  }
  if (trivial && words <= 25 && multiAsk <= 1) {
    reasons.push('short, single mechanical edit');
    return { level: 'trivial', reasons };
  }
  return { level: 'moderate', reasons };
}
