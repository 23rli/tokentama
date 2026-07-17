import { describe, expect, it } from 'vitest';
import { configuredCostUsd, creditAmount, creditAmountForMeteredUsage } from '../cost';
import type { TokenEstimate } from '@tokentama/shared-types';

function tokens(overrides: Partial<TokenEstimate>): TokenEstimate {
  return {
    inputTokens: 100,
    outputTokens: 20,
    estimatedCostUsd: 0,
    estimated: false,
    ...overrides,
  };
}

describe('creditAmount', () => {
  it('prefers metered Copilot credits, including a real zero', () => {
    expect(creditAmount(tokens({ copilotCredits: 0, estimatedCredits: 99 }))).toEqual({
      value: 0,
      estimated: false,
    });
  });

  it('falls back to estimated credits and marks the value honestly', () => {
    expect(creditAmount(tokens({ estimatedCredits: 12.5 }))).toEqual({
      value: 12.5,
      estimated: true,
    });
  });

  it('sanitizes missing or invalid estimates', () => {
    expect(creditAmount(undefined)).toEqual({ value: 0, estimated: true });
    expect(creditAmount(tokens({ copilotCredits: -1, estimatedCredits: Number.NaN }))).toEqual({
      value: 0,
      estimated: true,
    });
  });
});

describe('configuredCostUsd', () => {
  it('prefers the blended token rate when both rates are configured', () => {
    expect(configuredCostUsd(2_000_000, 100, 0.5, 0.25)).toBe(1);
  });

  it('falls back to the per-credit rate when the token rate is disabled', () => {
    expect(configuredCostUsd(2_000_000, 10, 0, 0.25)).toBe(2.5);
  });

  it('returns undefined when no valid rate is configured', () => {
    expect(configuredCostUsd(100, 10, 0, 0)).toBeUndefined();
    expect(configuredCostUsd(100, 10, -1, Number.NaN)).toBeUndefined();
  });
});

describe('creditAmountForMeteredUsage', () => {
  it('does not use a visible-prompt credit estimate when real input is missing', () => {
    expect(creditAmountForMeteredUsage(tokens({
      inputEstimated: true,
      outputEstimated: false,
      estimated: true,
      estimatedCredits: 99,
    }))).toEqual({ value: 0, estimated: true });
  });

  it('still preserves real credits on a partially metered request', () => {
    expect(creditAmountForMeteredUsage(tokens({
      inputEstimated: true,
      outputEstimated: false,
      estimated: true,
      copilotCredits: 4,
    }))).toEqual({ value: 4, estimated: false });
  });
});
