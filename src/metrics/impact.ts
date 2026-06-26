/**
 * Environmental-impact conversions. Pure + deterministic.
 * Defaults come from the per-token cost table: a single afternoon of "chat with
 * the codebase" (~100k tokens) ≈ 11 g CO2e and ~0.2 L of water.
 *   CO2e  = 0.11 g per 1,000 tokens  (110 g / 1M)
 *   Water = 2 mL  per 1,000 tokens  (2 L / 1M)
 */
export interface ImpactFactors {
  /** Grams CO2e per 1,000 tokens. */
  co2GramsPer1kTokens: number;
  /** Millilitres of water per 1,000 tokens. */
  waterMlPer1kTokens: number;
}

export const DEFAULT_IMPACT_FACTORS: ImpactFactors = {
  co2GramsPer1kTokens: 0.11,
  waterMlPer1kTokens: 2,
};

export interface Footprint {
  /** Grams of CO2e. */
  co2eGrams: number;
  /** Millilitres of water. */
  waterMl: number;
}

/** Convert a token count into its estimated CO2e + water footprint. */
export function footprint(
  tokens: number,
  factors: ImpactFactors = DEFAULT_IMPACT_FACTORS,
): Footprint {
  const thousands = Math.max(0, tokens) / 1000;
  return {
    co2eGrams: thousands * factors.co2GramsPer1kTokens,
    waterMl: thousands * factors.waterMlPer1kTokens,
  };
}
