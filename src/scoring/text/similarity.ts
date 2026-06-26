/** Text utilities shared by the heuristic detectors. */

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function tokenizeWords(text: string): string[] {
  return normalizeText(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Word n-gram shingles, used for similarity. */
export function shingles(tokens: string[], size = 3): Set<string> {
  const set = new Set<string>();
  if (tokens.length === 0) return set;
  if (tokens.length < size) {
    set.add(tokens.join(' '));
    return set;
  }
  for (let i = 0; i <= tokens.length - size; i++) {
    set.add(tokens.slice(i, i + size).join(' '));
  }
  return set;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Jaccard similarity over 3-gram word shingles. Range 0..1. */
export function similarity(a: string, b: string): number {
  return jaccard(shingles(tokenizeWords(a)), shingles(tokenizeWords(b)));
}

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Smooth 0..1 ramp: 0 at or below `lo`, 1 at or above `hi`, linear between. */
export function ramp(x: number, lo: number, hi: number): number {
  if (hi <= lo) return x >= hi ? 1 : 0;
  return clamp01((x - lo) / (hi - lo));
}

export function clampScore(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
