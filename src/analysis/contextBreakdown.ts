import type { ContextSlice } from '@tokentama/shared-types';

/**
 * Analyse where a turn's INPUT tokens actually go.
 *
 * The real cost of a Copilot turn is rarely the user's message — it's the fixed
 * overhead (system instructions + tool definitions) plus accumulated context and
 * history that get sent every turn. That overhead is a stable prefix, so it is
 * the prime candidate for prompt caching (charged at a fraction of the input rate
 * when it's a cache hit). This summary makes that visible and quantifies the lever.
 */
export interface ContextSummary {
  totalTokens: number;
  /** Fixed, stable prefix (system instructions + tool definitions) — cacheable. */
  overheadTokens: number;
  overheadPct: number;
  /** Everything conversation-specific: your messages, history, attached files. */
  conversationTokens: number;
  conversationPct: number;
  /** The single largest slice — the headline "where it went". */
  top?: ContextSlice;
  slices: ContextSlice[];
}

/** Labels/categories that form the stable, cacheable prefix of every prompt. */
const OVERHEAD_LABELS = new Set(['System Instructions', 'Tool Definitions']);
function isOverhead(slice: ContextSlice): boolean {
  return slice.category === 'System' || OVERHEAD_LABELS.has(slice.label);
}

export function summarizeContext(
  slices: ContextSlice[] | undefined,
  totalInputTokens: number,
): ContextSummary | undefined {
  if (!slices || slices.length === 0 || !(totalInputTokens > 0)) return undefined;

  let overheadTokens = 0;
  for (const s of slices) if (isOverhead(s)) overheadTokens += s.tokens;
  const conversationTokens = Math.max(0, totalInputTokens - overheadTokens);
  const top = [...slices].sort((a, b) => b.tokens - a.tokens)[0];

  const pct = (n: number): number => Math.round((n / totalInputTokens) * 100);
  return {
    totalTokens: totalInputTokens,
    overheadTokens,
    overheadPct: pct(overheadTokens),
    conversationTokens,
    conversationPct: pct(conversationTokens),
    top,
    slices: [...slices].sort((a, b) => b.tokens - a.tokens),
  };
}

/**
 * Estimated cost the stable overhead would incur at the FULL input rate vs. a
 * cache-read rate — i.e. the money left on the table by not caching the prefix.
 * Rates are per-1M tokens (Copilot credits or USD).
 */
export function cacheSavings(
  overheadTokens: number,
  inputPer1M: number | undefined,
  cacheReadPer1M: number | undefined,
): number | undefined {
  if (!(overheadTokens > 0) || inputPer1M == null || cacheReadPer1M == null) return undefined;
  const full = (overheadTokens * inputPer1M) / 1_000_000;
  const cached = (overheadTokens * cacheReadPer1M) / 1_000_000;
  return Math.max(0, full - cached);
}

/** Illustrative turns/day used to project the per-turn tool tax into a daily figure. */
export const TURNS_PER_DAY = 50;
/** Tool-definition share (%) at which we surface the "trim your tools" advisory. */
export const TOOL_ADVISORY_PCT = 25;

export interface ToolAdvisory {
  /** Tokens spent on tool definitions on THIS turn (re-sent every turn). */
  toolTokens: number;
  toolPct: number;
  /** Credits/USD spent on tool definitions per turn, at the input rate. */
  costPerTurn?: number;
  /** Illustrative cost over a TURNS_PER_DAY day — tool overhead is paid every turn. */
  costPerDay?: number;
  /** True when tool definitions are a large enough share to be worth trimming. */
  recommend: boolean;
}

/**
 * Tool-definition overhead advisory. Tool definitions are re-sent on EVERY turn,
 * so a large share is the highest-leverage thing to cut — disabling unused tools/
 * MCP servers reduces every future turn (and shrinks the cacheable prefix).
 */
export function toolAdvisory(
  slices: ContextSlice[] | undefined,
  totalInputTokens: number,
  inputPer1M?: number,
): ToolAdvisory | undefined {
  if (!slices || slices.length === 0 || !(totalInputTokens > 0)) return undefined;
  const toolTokens = slices
    .filter((s) => s.label === 'Tool Definitions')
    .reduce((sum, s) => sum + s.tokens, 0);
  if (toolTokens <= 0) return undefined;

  const toolPct = Math.round((toolTokens / totalInputTokens) * 100);
  const costPerTurn =
    inputPer1M != null ? (toolTokens * inputPer1M) / 1_000_000 : undefined;
  return {
    toolTokens,
    toolPct,
    costPerTurn,
    costPerDay: costPerTurn != null ? costPerTurn * TURNS_PER_DAY : undefined,
    recommend: toolPct >= TOOL_ADVISORY_PCT,
  };
}

