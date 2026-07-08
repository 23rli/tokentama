import { describe, it, expect } from 'vitest';
import {
  forecastTurn,
  forecastLastValue,
  forecastEmaDelta,
  type TurnHistory,
} from '../forecast';

describe('forecastTurn', () => {
  it('cold start: no history → overhead + draft, low confidence', () => {
    const f = forecastTurn({ history: [], draftPrompt: 'add a null check' });
    expect(f.basis).toBe('coldstart');
    expect(f.breakdown.draft).toBeGreaterThan(0);
    expect(f.predictedInputTokens).toBe(f.breakdown.carriedContext + f.breakdown.draft);
    expect(f.confidence).toBeLessThan(0.5);
  });

  it('structural: predicts last input + last completion + learned growth + draft', () => {
    // Steady session: each turn adds ~1000 tool-result tokens beyond the known parts.
    const history: TurnHistory[] = [
      { promptTokens: 10_000, completionTokens: 500, promptText: 'a'.repeat(400) },
      { promptTokens: 11_600, completionTokens: 500, promptText: 'b'.repeat(400) }, // 10000+500+100+~1000
      { promptTokens: 13_200, completionTokens: 500, promptText: 'c'.repeat(400) },
    ];
    const f = forecastTurn({ history, draftPrompt: 'd'.repeat(400) });
    expect(f.basis).toBe('structural');
    // carried = last promptTokens + last completion
    expect(f.breakdown.carriedContext).toBe(13_200 + 500);
    // growth learned from residuals (~1000), draft ~100
    expect(f.breakdown.growth).toBeGreaterThan(500);
    expect(f.predictedInputTokens).toBeGreaterThan(13_700);
  });

  it('identifies the hungriest contributor (carried context dominates in agent mode)', () => {
    const history: TurnHistory[] = [
      { promptTokens: 300_000, completionTokens: 2_000, promptText: 'hi' },
      { promptTokens: 320_000, completionTokens: 2_000, promptText: 'hi' },
    ];
    const f = forecastTurn({ history, draftPrompt: 'short ask' });
    expect(f.hungriest).toBe('carriedContext');
    // A short prompt is a rounding error against carried context — the honest point.
    expect(f.breakdown.draft).toBeLessThan(f.breakdown.carriedContext / 100);
  });

  it('confidence rises with history length', () => {
    const short = forecastTurn({
      history: [{ promptTokens: 10_000, completionTokens: 500, promptText: 'x' }],
      draftPrompt: 'y',
    });
    const long: TurnHistory[] = Array.from({ length: 10 }, (_, i) => ({
      promptTokens: 10_000 + i * 1_000,
      completionTokens: 500,
      promptText: 'x'.repeat(40),
    }));
    const longF = forecastTurn({ history: long, draftPrompt: 'y' });
    expect(longF.confidence).toBeGreaterThan(short.confidence);
  });
});

describe('baselines (for the accuracy harness)', () => {
  it('last-value returns the previous turn input', () => {
    const history: TurnHistory[] = [
      { promptTokens: 10_000 },
      { promptTokens: 12_000 },
    ];
    expect(forecastLastValue({ history, draftPrompt: '' })).toBe(12_000);
  });

  it('EMA-delta projects the recent growth forward', () => {
    const history: TurnHistory[] = [
      { promptTokens: 10_000 },
      { promptTokens: 11_000 },
      { promptTokens: 12_000 },
    ];
    expect(forecastEmaDelta({ history, draftPrompt: '' })).toBeGreaterThan(12_000);
  });
});

describe('model-agnostic adaptivity (not fragile across models)', () => {
  const steady = (n: number, base: number, step: number): TurnHistory[] =>
    Array.from({ length: n }, (_, i) => ({
      promptTokens: base + i * step,
      completionTokens: Math.round(step * 0.3),
      promptText: 'x'.repeat(40),
    }));

  it('reset flag is RELATIVE to the model limit — fires near a small window', () => {
    // A 128k-window model, context sitting near the limit (~94%) → reset likely.
    const history = steady(10, 116_000, 500); // ~120k, near 128k×0.9≈115k trigger
    const f = forecastTurn({ history, draftPrompt: 'go', model: { maxInputTokens: 128_000 } });
    expect(f.resetRisk).toBe('high');
    expect(f.resetBaseline).toBeGreaterThan(0);
  });

  it('the SAME small absolute size does NOT flag on a large-window model', () => {
    const history = steady(10, 90_000, 1_000); // same ~99k context
    const f = forecastTurn({ history, draftPrompt: 'go', model: { maxInputTokens: 1_000_000 } });
    // 99k is nowhere near 1M×0.75 → no false reset. This is what the old absolute
    // 60k threshold got wrong.
    expect(f.resetRisk).toBe('low');
  });

  it('with no model info and no observed reset, never fabricates a reset flag', () => {
    const history = steady(10, 300_000, 5_000);
    const f = forecastTurn({ history, draftPrompt: 'go' });
    expect(f.resetRisk).toBe('low');
  });

  it('interval self-calibrates: a volatile session gets a WIDER band than a steady one', () => {
    const steadyHist = steady(12, 50_000, 1_000);
    const volatileHist: TurnHistory[] = steady(12, 50_000, 1_000).map((t, i) => ({
      ...t,
      // alternate big/small jumps to inflate the actual/predicted spread
      promptTokens: t.promptTokens + (i % 2 === 0 ? 20_000 : -8_000),
    }));
    const s = forecastTurn({ history: steadyHist, draftPrompt: 'go' });
    const v = forecastTurn({ history: volatileHist, draftPrompt: 'go' });
    const widthS = (s.interval.high - s.interval.low) / s.predictedInputTokens;
    const widthV = (v.interval.high - v.interval.low) / v.predictedInputTokens;
    expect(widthV).toBeGreaterThan(widthS);
  });

  it('point prediction is scale-covariant (tokenizer-independent shape)', () => {
    const base = steady(8, 40_000, 2_000);
    const scaled = base.map((t) => ({
      ...t,
      promptTokens: t.promptTokens * 3,
      completionTokens: (t.completionTokens ?? 0) * 3,
    }));
    const f1 = forecastTurn({ history: base, draftPrompt: 'go' });
    const f3 = forecastTurn({ history: scaled, draftPrompt: 'go' });
    // Predictions scale ~proportionally (the draft-token term is the only fixed part).
    const ratio = f3.predictedInputTokens / f1.predictedInputTokens;
    expect(ratio).toBeGreaterThan(2.8);
    expect(ratio).toBeLessThan(3.2);
  });

  it('tool-aware growth: a heavy last turn raises the forecast above the flat median', () => {
    // A session with a clear per-tool token rate: each tool call ≈ +2k tokens.
    const build = (lastToolCalls: number): TurnHistory[] => [
      { promptTokens: 20_000, completionTokens: 400, promptText: 'x'.repeat(40), toolCalls: 1 },
      { promptTokens: 22_500, completionTokens: 400, promptText: 'x'.repeat(40), toolCalls: 1 }, // +~2k/tool
      { promptTokens: 25_000, completionTokens: 400, promptText: 'x'.repeat(40), toolCalls: 1 },
      { promptTokens: 27_500, completionTokens: 400, promptText: 'x'.repeat(40), toolCalls: lastToolCalls },
    ];
    const light = forecastTurn({ history: build(1), draftPrompt: 'go' });
    const heavy = forecastTurn({ history: build(12), draftPrompt: 'go' });
    // The heavy last turn (12 tools) should predict a much larger next input.
    expect(heavy.predictedInputTokens).toBeGreaterThan(light.predictedInputTokens);
    expect(heavy.breakdown.growth).toBeGreaterThan(light.breakdown.growth);
  });

  it('tool-aware growth never underestimates below the median floor', () => {
    // Last turn made ZERO tool calls — tool estimate would be 0, but the blend
    // keeps the median floor so we do not under-predict.
    const history: TurnHistory[] = [
      { promptTokens: 20_000, completionTokens: 400, promptText: 'x'.repeat(40), toolCalls: 5 },
      { promptTokens: 24_000, completionTokens: 400, promptText: 'x'.repeat(40), toolCalls: 5 },
      { promptTokens: 28_000, completionTokens: 400, promptText: 'x'.repeat(40), toolCalls: 5 },
      { promptTokens: 32_000, completionTokens: 400, promptText: 'x'.repeat(40), toolCalls: 0 },
    ];
    const f = forecastTurn({ history, draftPrompt: 'go' });
    expect(f.breakdown.growth).toBeGreaterThan(0);
  });
});
