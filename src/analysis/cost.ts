import type { TokenEstimate } from '@tokentama/shared-types';

export interface CreditAmount {
  value: number;
  /** True when the value falls back to model-based pricing rather than metered AICs. */
  estimated: boolean;
}

/** Pick the real Copilot credit value when present, otherwise its local estimate. */
export function creditAmount(tokens: TokenEstimate | undefined): CreditAmount {
  const real = tokens?.copilotCredits;
  if (typeof real === 'number' && Number.isFinite(real) && real >= 0) {
    return { value: real, estimated: false };
  }

  const estimated = tokens?.estimatedCredits;
  return {
    value:
      typeof estimated === 'number' && Number.isFinite(estimated) && estimated >= 0
        ? estimated
        : 0,
    estimated: true,
  };
}

/**
 * Credit value suitable for a measured scope. If Copilot omitted input metering
 * and real credits, do not invent credits from the tiny visible-prompt fallback.
 */
export function creditAmountForMeteredUsage(
  tokens: TokenEstimate | undefined,
): CreditAmount {
  const amount = creditAmount(tokens);
  if (!amount.estimated) return amount;
  const inputMetered = tokens?.inputEstimated != null
    ? !tokens.inputEstimated
    : tokens?.estimated === false;
  return inputMetered ? amount : { value: 0, estimated: true };
}

/**
 * Convert a scope's metered totals to USD using the configured precedence:
 * tokens first, then AICs. Returns undefined when neither rate is configured.
 */
export function configuredCostUsd(
  tokens: number,
  credits: number,
  usdPerMillionTokens: number,
  usdPerCredit: number,
): number | undefined {
  const safeTokens = Number.isFinite(tokens) ? Math.max(0, tokens) : 0;
  const safeCredits = Number.isFinite(credits) ? Math.max(0, credits) : 0;
  if (Number.isFinite(usdPerMillionTokens) && usdPerMillionTokens > 0) {
    return (safeTokens * usdPerMillionTokens) / 1_000_000;
  }
  if (Number.isFinite(usdPerCredit) && usdPerCredit > 0) {
    return safeCredits * usdPerCredit;
  }
  return undefined;
}
