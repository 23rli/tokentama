import type { CorpusRecord } from '../data/corpusStore';
import { deriveInsights, hasTarget } from './corpusInsights';

/**
 * A compact, continuously-updated profile of the user, distilled from the corpus.
 *
 * Rather than feeding the model many raw examples (expensive), we compress the
 * corpus into a tiny profile — what the user works on, what they prefer, their
 * wins and recurring problems — and pair it with a general standards set. This
 * few-hundred-token block is what the rewriter "runs off of": it improves rewrites
 * while keeping the rewrite call itself cheap, and it updates every session as the
 * corpus grows.
 */
export interface UserPortfolio {
  topTargets: string[];
  prefersTests: boolean;
  prefersDiff: boolean;
  typicalPromptChars: number;
  wins: string[];
  problems: string[];
}

/** General best-practice standards, combined with the personal profile. */
export const GENERAL_STANDARDS: string[] = [
  'Name the exact target (file / function / component).',
  'State the expected output and its format (a diff, one function, N bullets).',
  'Reference existing context by name instead of re-pasting it.',
  'Be concise: drop politeness padding and do not restate the question.',
];

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function frac(records: CorpusRecord[], pred: (r: CorpusRecord) => boolean): number {
  return records.length ? records.filter(pred).length / records.length : 0;
}
function avgRetry(records: CorpusRecord[]): number {
  return records.length
    ? records.reduce((sum, r) => sum + (r.retryCount || 0), 0) / records.length
    : 0;
}

export function buildPortfolio(records: CorpusRecord[]): UserPortfolio {
  const withText = records.filter((r) => r.promptText);
  const topTargets = deriveInsights(records).topTargets;
  const prefersTests = frac(withText, (r) => /\btest(?:s|ing)?\b/i.test(r.promptText!)) > 0.25;
  const prefersDiff = frac(withText, (r) => /\b(?:diff|patch)\b/i.test(r.promptText!)) > 0.15;
  const typicalPromptChars = Math.round(median(records.map((r) => r.promptChars)));

  const overall = avgRetry(records);
  const vague = records.filter((r) => r.wasteCategories.includes('vagueness'));
  const targeted = withText.filter((r) => hasTarget(r.promptText!));

  const wins: string[] = [];
  const problems: string[] = [];
  if (targeted.length >= 3 && avgRetry(targeted) < overall) {
    wins.push('Prompts that name the target file usually land on the first try.');
  }
  if (vague.length >= 3 && avgRetry(vague) > overall) {
    problems.push('Vague asks with no named target tend to need a retry.');
  }
  if (frac(records, (r) => r.wasteCategories.includes('verbosityMismatch')) > 0.3) {
    problems.push('Politeness / filler padding inflates your prompts.');
  }
  if (frac(records, (r) => r.wasteCategories.includes('redundantContext')) > 0.3) {
    problems.push('Re-pasted context is a recurring cost — reference it by name.');
  }
  return { topTargets, prefersTests, prefersDiff, typicalPromptChars, wins, problems };
}

/** Render the profile + standards as a compact guidance block for the rewriter. */
export function renderPortfolio(p: UserPortfolio, standards = GENERAL_STANDARDS): string {
  const standardsBlock = ['STANDARDS:', ...standards.map((s) => `- ${s}`)];
  const profile: string[] = [];
  if (p.topTargets.length) profile.push(`- Usually works in: ${p.topTargets.join(', ')}`);
  const formats = [p.prefersTests ? 'tests' : '', p.prefersDiff ? 'diffs' : ''].filter(Boolean);
  if (formats.length) profile.push(`- Prefers output as: ${formats.join(', ')}`);
  for (const w of p.wins) profile.push(`- Win: ${w}`);
  for (const pr of p.problems) profile.push(`- Watch-out: ${pr}`);

  if (profile.length === 0) return standardsBlock.join('\n');
  return ['YOUR PROFILE (learned, private):', ...profile, '', ...standardsBlock].join('\n');
}
