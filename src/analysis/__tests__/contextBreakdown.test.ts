import { describe, it, expect } from 'vitest';
import { summarizeContext, cacheSavings, toolAdvisory, TURNS_PER_DAY } from '../contextBreakdown';
import type { ContextSlice } from '@tokentama/shared-types';

const slices: ContextSlice[] = [
  { category: 'System', label: 'System Instructions', pct: 40, tokens: 4000 },
  { category: 'System', label: 'Tool Definitions', pct: 47, tokens: 4700 },
  { category: 'User Context', label: 'Messages', pct: 13, tokens: 1300 },
];

describe('summarizeContext', () => {
  it('splits fixed overhead (system + tools) from conversation', () => {
    const s = summarizeContext(slices, 10000)!;
    expect(s.overheadTokens).toBe(8700);
    expect(s.overheadPct).toBe(87);
    expect(s.conversationTokens).toBe(1300);
    expect(s.conversationPct).toBe(13);
  });

  it('reports the largest slice as the headline', () => {
    expect(summarizeContext(slices, 10000)!.top!.label).toBe('Tool Definitions');
  });

  it('returns undefined without data', () => {
    expect(summarizeContext(undefined, 10000)).toBeUndefined();
    expect(summarizeContext(slices, 0)).toBeUndefined();
  });
});

describe('cacheSavings', () => {
  it('is the gap between full-rate and cache-rate cost of the overhead', () => {
    // 8700 tokens at 500/1M vs 50/1M → (8700*450)/1e6
    expect(cacheSavings(8700, 500, 50)).toBeCloseTo((8700 * 450) / 1_000_000, 6);
  });

  it('is undefined without rates', () => {
    expect(cacheSavings(8700, undefined, 50)).toBeUndefined();
  });
});

describe('toolAdvisory', () => {
  it('quantifies tool-definition overhead and projects a daily cost', () => {
    const a = toolAdvisory(slices, 10000, 500)!;
    expect(a.toolTokens).toBe(4700);
    expect(a.toolPct).toBe(47);
    expect(a.recommend).toBe(true);
    expect(a.costPerTurn).toBeCloseTo((4700 * 500) / 1_000_000, 6);
    expect(a.costPerDay).toBeCloseTo(a.costPerTurn! * TURNS_PER_DAY, 6);
  });

  it('does not recommend when tools are a small share', () => {
    const small: ContextSlice[] = [
      { category: 'System', label: 'System Instructions', pct: 90, tokens: 9000 },
      { category: 'System', label: 'Tool Definitions', pct: 10, tokens: 1000 },
    ];
    expect(toolAdvisory(small, 10000, 500)!.recommend).toBe(false);
  });

  it('returns undefined when there are no tool definitions', () => {
    const none: ContextSlice[] = [
      { category: 'User Context', label: 'Messages', pct: 100, tokens: 10000 },
    ];
    expect(toolAdvisory(none, 10000, 500)).toBeUndefined();
  });
});
