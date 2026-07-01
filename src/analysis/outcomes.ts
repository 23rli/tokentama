import type { CorpusRecord } from '../data/corpusStore';

/**
 * Close the quality loop: did our interventions actually help, without causing
 * more retries? A retry is the costliest miss (it re-sends a whole turn), so we
 * compare the retry rate on turns where the user ADOPTED prior coaching vs. where
 * they didn't. If adopting lowers the retry rate, savings came without a quality
 * cost. Estimated tokens saved values each avoided retry at an average turn's input.
 */
export interface OutcomeReport {
  totalTurns: number;
  retryRate: number;
  adoptedCount: number;
  notAdoptedCount: number;
  retryRateAdopted?: number;
  retryRateNotAdopted?: number;
  /** Positive when adopting coaching correlates with fewer retries. */
  retryReductionPct?: number;
  estRetriesAvoided: number;
  estTokensSaved: number;
  /** Tokens Tokentama itself spent (LLM rewrites) — the maintenance cost. */
  toolTokensSpent: number;
  /** Net = estimated tokens saved minus the tool's own spend (can be negative). */
  netTokensSaved: number;
  /** True once both cohorts have enough samples for the comparison to be meaningful. */
  hasSignal: boolean;
}

const MIN_SAMPLE = 5;

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
}

export function computeOutcomes(
  records: CorpusRecord[],
  toolTokensSpent = 0,
): OutcomeReport {
  const isRetry = (r: CorpusRecord): boolean => (r.retryCount ?? 0) > 0;
  const total = records.length;
  const retries = records.filter(isRetry).length;

  const adopted = records.filter((r) => r.adopted === true);
  const notAdopted = records.filter((r) => r.adopted === false);
  const rate = (arr: CorpusRecord[]): number | undefined =>
    arr.length >= MIN_SAMPLE ? arr.filter(isRetry).length / arr.length : undefined;

  const retryRateAdopted = rate(adopted);
  const retryRateNotAdopted = rate(notAdopted);

  let retryReductionPct: number | undefined;
  let estRetriesAvoided = 0;
  let estTokensSaved = 0;
  const hasSignal = retryRateAdopted != null && retryRateNotAdopted != null;

  if (hasSignal && retryRateNotAdopted! > 0) {
    retryReductionPct = Math.round(
      ((retryRateNotAdopted! - retryRateAdopted!) / retryRateNotAdopted!) * 100,
    );
    const avoidedRate = Math.max(0, retryRateNotAdopted! - retryRateAdopted!);
    estRetriesAvoided = Math.round(avoidedRate * adopted.length);
    // Each avoided retry saves roughly one full turn's worth of input tokens.
    estTokensSaved = Math.round(estRetriesAvoided * avg(adopted.map((r) => r.inputTokens)));
  }

  return {
    totalTurns: total,
    retryRate: total ? retries / total : 0,
    adoptedCount: adopted.length,
    notAdoptedCount: notAdopted.length,
    retryRateAdopted,
    retryRateNotAdopted,
    retryReductionPct,
    estRetriesAvoided,
    estTokensSaved,
    toolTokensSpent: Math.round(toolTokensSpent),
    netTokensSaved: Math.round(estTokensSaved - toolTokensSpent),
    hasSignal,
  };
}
