import { describe, it, expect } from 'vitest';
import { ForecastService } from '../forecastService';

describe('ForecastService', () => {
  it('accumulates history and forecasts the next turn', () => {
    const svc = new ForecastService();
    svc.recordTurn({ promptTokens: 20_000, completionTokens: 500, promptText: 'start', toolCalls: 2 });
    svc.recordTurn({ promptTokens: 24_000, completionTokens: 500, promptText: 'more', toolCalls: 2 });
    expect(svc.turnCount).toBe(2);
    const f = svc.forecastNext('add a test');
    expect(f.predictedInputTokens).toBeGreaterThan(24_000);
    expect(f.interval.low).toBeLessThan(f.predictedInputTokens);
    expect(f.interval.high).toBeGreaterThan(f.predictedInputTokens);
  });

  it('scores its own predictions against the real next turn', () => {
    const svc = new ForecastService();
    // Feed a steady session; predictions should be close, so score stays high.
    let tokens = 30_000;
    for (let i = 0; i < 10; i++) {
      svc.recordTurn({ promptTokens: tokens, completionTokens: 400, promptText: 'x'.repeat(40), toolCalls: 1 });
      tokens += 2_000;
    }
    const acc = svc.accuracy();
    expect(acc.samples).toBeGreaterThan(0);
    expect(acc.score).toBeGreaterThan(80); // steady growth is easy to predict
    expect(acc.intervalCoverage).toBeGreaterThan(0.5);
    expect(acc.medianAbsPctError).toBeLessThan(0.2);
  });

  it('reset clears session history but keeps the accuracy record', () => {
    const svc = new ForecastService();
    for (let i = 0; i < 6; i++) {
      svc.recordTurn({ promptTokens: 10_000 + i * 1_000, completionTokens: 300, promptText: 'x', toolCalls: 1 });
    }
    const before = svc.accuracy().samples;
    svc.reset();
    expect(svc.turnCount).toBe(0);
    expect(svc.accuracy().samples).toBe(before); // accuracy is a model property, retained
  });

  it('uses the model limit for reset risk (model-agnostic)', () => {
    const svc = new ForecastService();
    // Climb near a small model's limit (~94% of 128k) → reset risk should light up.
    for (let i = 0; i < 10; i++) {
      svc.recordTurn(
        { promptTokens: 116_000 + i * 500, completionTokens: 300, promptText: 'x'.repeat(40), toolCalls: 1 },
        { maxInputTokens: 128_000 },
      );
    }
    const f = svc.forecastNext('go');
    expect(f.resetRisk).toBe('high');
  });
});
