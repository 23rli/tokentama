import type { SuccessMetrics } from '../webview/contract';
import { footprint, type ImpactFactors } from './impact';

/** One scored prompt, reduced to the numbers the metrics need. */
export interface ScoredRecord {
  timestamp: string;
  overallScore: number;
  wasteScore: number;
  promptQuality: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  credits: number;
  delta: number;
}

export interface Counters {
  tipsShown: number;
  tipsApplied: number;
}

export interface SustainabilityConfig {
  whPerThousandTokens: number;
  gridGramsCo2PerKwh: number;
  /** Grams CO2e per 1,000 tokens (headline impact). */
  co2GramsPer1kTokens: number;
  /** Millilitres of water per 1,000 tokens (headline impact). */
  waterMlPer1kTokens: number;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Compute the six headline success metrics from the session's scored history.
 * Baseline vs. recent are compared over small windows so the numbers move
 * meaningfully during a live demo without a single outlier dominating.
 */
export function computeMetrics(
  records: ScoredRecord[],
  counters: Counters,
  sustain: SustainabilityConfig,
): SuccessMetrics {
  const n = records.length;
  const k = Math.max(1, Math.min(3, Math.floor(n / 2) || 1));
  const baseline = records.slice(0, k);
  const recent = records.slice(-k);

  const baseTokens = avg(baseline.map((r) => r.inputTokens + r.outputTokens));
  const recentTokens = avg(recent.map((r) => r.inputTokens + r.outputTokens));
  const baseWaste = avg(baseline.map((r) => r.wasteScore));
  const recentWaste = avg(recent.map((r) => r.wasteScore));
  const basePQ = avg(baseline.map((r) => r.promptQuality));
  const recentPQ = avg(recent.map((r) => r.promptQuality));

  const tokenReductionPct = baseTokens > 0 ? ((baseTokens - recentTokens) / baseTokens) * 100 : 0;
  const wasteReductionPct = baseWaste > 0 ? ((baseWaste - recentWaste) / baseWaste) * 100 : 0;
  const promptQualityImprovementPct =
    basePQ > 0 ? ((recentPQ - basePQ) / basePQ) * 100 : 0;

  const deltas = records.slice(1).map((r) => r.delta);
  const averageScoreIncrease = avg(deltas);

  const coachingEngagement =
    counters.tipsShown > 0 ? counters.tipsApplied / counters.tipsShown : 0;

  const tokensSavedPerPrompt = Math.max(0, baseTokens - recentTokens);
  const tokensSaved = tokensSavedPerPrompt * n;
  const sustainabilityWhSaved = (tokensSaved / 1000) * sustain.whPerThousandTokens;
  const sustainabilityCo2eGrams = (sustainabilityWhSaved / 1000) * sustain.gridGramsCo2PerKwh;

  const totalTokens = records.reduce((a, r) => a + r.inputTokens + r.outputTokens, 0);
  const totalCostUsd = records.reduce((a, r) => a + r.costUsd, 0);
  const totalCredits = records.reduce((a, r) => a + (r.credits ?? 0), 0);

  const factors: ImpactFactors = {
    co2GramsPer1kTokens: sustain.co2GramsPer1kTokens,
    waterMlPer1kTokens: sustain.waterMlPer1kTokens,
  };
  const wasteFraction = (w: number): number => Math.max(0, Math.min(100, w)) / 100;
  const totalFootprint = footprint(totalTokens, factors);
  const wastedTokens = records.reduce(
    (a, r) => a + (r.inputTokens + r.outputTokens) * wasteFraction(r.wasteScore),
    0,
  );
  const wastedFootprint = footprint(wastedTokens, factors);
  const costUsdWasted = records.reduce((a, r) => a + r.costUsd * wasteFraction(r.wasteScore), 0);

  return {
    tokenReductionPct,
    wasteReductionPct,
    promptQualityImprovementPct,
    averageScoreIncrease,
    coachingEngagement,
    sustainabilityWhSaved,
    sustainabilityCo2eGrams,
    promptsScored: n,
    tipsShown: counters.tipsShown,
    tipsApplied: counters.tipsApplied,
    totalTokens,
    totalCostUsd,
    totalCredits,
    co2eGramsTotal: totalFootprint.co2eGrams,
    waterMlTotal: totalFootprint.waterMl,
    co2eGramsWasted: wastedFootprint.co2eGrams,
    waterMlWasted: wastedFootprint.waterMl,
    costUsdWasted,
  };
}
