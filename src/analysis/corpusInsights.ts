import type { CorpusRecord } from '../data/corpusStore';

/**
 * Zero-token, on-device insights derived from the local corpus.
 *
 * The corpus's job is to make prompts cheaper WITHOUT spending tokens: learn the
 * user's own patterns (which files they target, formats they want) so we can fill
 * context gaps offline — turning a vague ask into a specific one that avoids a
 * retry, at no token cost. This is the "cheap and personal" path; an LLM rewrite
 * is only a fallback for the cases offline can't cover.
 */

const FILE_RE =
  /\b[\w-]{2,}\.(?:ts|tsx|js|jsx|mjs|cjs|py|java|go|rb|rs|cs|cpp|cc|c|h|hpp|css|scss|html|json|md|ya?ml|sql|sh|ps1|vue|svelte|php|kt|swift|toml|ini|xml)\b/gi;
const PATH_RE = /\b(?:[\w-]+\/){1,}[\w.-]+\b/g;

/** File/path targets referenced in a piece of text. */
export function extractTargets(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(FILE_RE)) out.add(m[0]);
  for (const m of text.matchAll(PATH_RE)) out.add(m[0]);
  return [...out];
}

/** Whether the prompt already names a concrete target (file/path). */
export function hasTarget(text: string): boolean {
  return extractTargets(text).length > 0;
}

export interface CorpusInsights {
  /** The user's most frequently referenced files/paths. */
  topTargets: string[];
}

/** Derive the user's frequent targets from their corpus (seen at least twice). */
export function deriveInsights(records: CorpusRecord[], topN = 3): CorpusInsights {
  const counts = new Map<string, number>();
  for (const r of records) {
    if (!r.promptText) continue;
    for (const t of extractTargets(r.promptText)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const topTargets = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([t]) => t);
  return { topTargets };
}
