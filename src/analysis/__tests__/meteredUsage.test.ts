import { describe, expect, it } from 'vitest';
import type { PromptEvent, TokenEstimate } from '@tokentama/shared-types';
import { meteredTokenParts, summarizeMeteredUsage } from '../meteredUsage';

function tokens(overrides: Partial<TokenEstimate>): TokenEstimate {
  return {
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    estimated: false,
    ...overrides,
  };
}

describe('metered usage', () => {
  it('keeps real output when input metering is missing', () => {
    expect(meteredTokenParts(tokens({
      inputTokens: 12,
      outputTokens: 8_470,
      inputEstimated: true,
      outputEstimated: false,
      estimated: true,
    }))).toEqual({
      input: 0,
      output: 8_470,
      total: 8_470,
      inputMetered: false,
      outputMetered: true,
      anyMetered: true,
      fullyMetered: false,
      partial: true,
    });
  });

  it('drops pending local estimates', () => {
    expect(meteredTokenParts(tokens({
      inputTokens: 10,
      outputTokens: 20,
      inputEstimated: true,
      outputEstimated: true,
      estimated: true,
    })).total).toBe(0);
  });

  it('sums known directions and marks the scope partial', () => {
    const events = [
      { tokens: tokens({ inputTokens: 100, outputTokens: 20, inputEstimated: false, outputEstimated: false }) },
      { tokens: tokens({ inputTokens: 3, outputTokens: 80, inputEstimated: true, outputEstimated: false, estimated: true }) },
    ] as PromptEvent[];
    expect(summarizeMeteredUsage(events)).toEqual({
      input: 100,
      output: 100,
      total: 200,
      measuredTurns: 2,
      partialTurns: 1,
      partial: true,
    });
  });

  it('supports legacy fully-metered events without direction flags', () => {
    expect(meteredTokenParts(tokens({ inputTokens: 100, outputTokens: 20 }))).toMatchObject({
      total: 120,
      fullyMetered: true,
    });
  });
});