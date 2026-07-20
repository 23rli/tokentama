import { describe, it, expect } from 'vitest';
import { buildForecastView, type ForecastViewExtras } from '../forecastView';
import type { Forecast } from '../forecast';
import type { ForecastAccuracy } from '../forecastService';
import type { PromptEvent } from '@tokentama/shared-types';

const acc: ForecastAccuracy = { score: 90, samples: 5, intervalCoverage: 0.9, medianAbsPctError: 10 };
const extras: ForecastViewExtras = { turnCount: 3, contextSeries: [1000, 2000, 3000] };

function mkForecast(over: Partial<Forecast> = {}): Forecast {
  return {
    predictedInputTokens: 100_000,
    interval: { low: 90_000, high: 120_000 },
    breakdown: { carriedContext: 500_000, growth: 5_000, draft: 200 },
    basis: 'structural',
    confidence: 0.8,
    resetRisk: 'low',
    ...over,
  };
}

// Minimal PromptEvent — buildForecastView only reads `model` + `tokens.outputTokens`.
function mkEvent(model?: Record<string, unknown>): PromptEvent {
  return {
    model,
    tokens: { outputTokens: 1000 },
  } as unknown as PromptEvent;
}

const model = {
  id: 'opus',
  family: 'opus',
  contextMaxTokens: 1_000_000,
  maxInputTokens: 900_000,
  inputPer1M: 500,
  outputPer1M: 2500,
  cacheReadPer1M: 50,
};

describe('buildForecastView', () => {
  it('computes load fraction against the FULL context window and echoes the limit', () => {
    const v = buildForecastView(mkForecast({ breakdown: { carriedContext: 500_000, growth: 0, draft: 0 } }), acc, mkEvent(model), extras);
    expect(v.contextLimit).toBe(1_000_000);
    expect(v.loadFraction).toBeCloseTo(0.5, 5);
    expect(v.contextTokens).toBe(500_000);
  });

  it('falls back to maxInputTokens when contextMaxTokens is absent', () => {
    const v = buildForecastView(mkForecast(), acc, mkEvent({ ...model, contextMaxTokens: undefined }), extras);
    expect(v.contextLimit).toBe(900_000);
  });

  it.each([
    [950_000, 'overloaded'],
    [800_000, 'critical'],
    [600_000, 'heavy'],
    [400_000, 'moderate'],
    [100_000, 'light'],
  ] as const)('maps load %i tokens to the "%s" band', (carried, band) => {
    const v = buildForecastView(mkForecast({ breakdown: { carriedContext: carried, growth: 0, draft: 0 } }), acc, mkEvent(model), extras);
    expect(v.contextBand).toBe(band);
  });

  it('forces the "overloaded" band when a reset is likely, regardless of load', () => {
    const v = buildForecastView(mkForecast({ resetRisk: 'high', breakdown: { carriedContext: 50_000, growth: 0, draft: 0 } }), acc, mkEvent(model), extras);
    expect(v.contextBand).toBe('overloaded');
  });

  it('has no limit/fraction/credits when the model is unknown, and stays "light"', () => {
    const v = buildForecastView(mkForecast(), acc, mkEvent(undefined), extras);
    expect(v.contextLimit).toBeUndefined();
    expect(v.loadFraction).toBeUndefined();
    expect(v.predictedCredits).toBeUndefined();
    expect(v.contextBand).toBe('light');
  });

  it('derives a numeric credit estimate when the model is known', () => {
    const v = buildForecastView(mkForecast(), acc, mkEvent(model), extras);
    expect(typeof v.predictedCredits).toBe('number');
    expect(Number.isFinite(v.predictedCredits)).toBe(true);
  });

  it('passes through the real/last, accuracy, and whole-chat cost fields', () => {
    const v = buildForecastView(mkForecast(), acc, mkEvent(model), {
      ...extras,
      realLastInputTokens: 121_000,
      realLastTotalTokens: 125_000,
      realLastCredits: 132,
      realLastCostUsd: 0.42,
      realLastIsToday: true,
      forecastTarget: 'pending',
      aggregateScope: 'allWindows',
      chatTotalTokens: 6_100_000,
      chatTokensPartial: true,
      chatCredits: 5500,
      chatCostUsd: 3.54,
      chatCostPartial: true,
      sessionTokensPartial: true,
      sessionCostPartial: true,
      todayTokensPartial: true,
      todayCostPartial: true,
      allTurns: [{ prompt: 'hi', tokens: 100, metered: true, status: 'metered' }],
    });
    expect(v.realLastInputTokens).toBe(121_000);
    expect(v.realLastTotalTokens).toBe(125_000);
    expect(v.realLastCredits).toBe(132);
    expect(v.realLastCostUsd).toBe(0.42);
    expect(v.realLastIsToday).toBe(true);
    expect(v.forecastTarget).toBe('pending');
    expect(v.aggregateScope).toBe('allWindows');
    expect(v.accuracyScore).toBe(90);
    expect(v.accuracySamples).toBe(5);
    expect(v.intervalCoverage).toBe(0.9);
    expect(v.chatTotalTokens).toBe(6_100_000);
    expect(v.chatTokensPartial).toBe(true);
    expect(v.sessionTokensPartial).toBe(true);
    expect(v.todayTokensPartial).toBe(true);
    expect(v.chatCostPartial).toBe(true);
    expect(v.sessionCostPartial).toBe(true);
    expect(v.todayCostPartial).toBe(true);
    expect(v.chatCostUsd).toBeCloseTo(3.54, 5);
    expect(v.allTurns).toHaveLength(1);
    expect(v.predictedInputTokens).toBe(100_000);
    expect(v.intervalLow).toBe(90_000);
    expect(v.intervalHigh).toBe(120_000);
  });
});
