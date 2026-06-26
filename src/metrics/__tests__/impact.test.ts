import { describe, it, expect } from 'vitest';
import { footprint, DEFAULT_IMPACT_FACTORS } from '../impact';

describe('footprint', () => {
  it('matches the per-token table at 1k / 100k / 1M tokens', () => {
    expect(footprint(1000).co2eGrams).toBeCloseTo(0.11, 5);
    expect(footprint(1000).waterMl).toBeCloseTo(2, 5);
    expect(footprint(100_000).co2eGrams).toBeCloseTo(11, 5);
    expect(footprint(100_000).waterMl).toBeCloseTo(200, 5);
    expect(footprint(1_000_000).co2eGrams).toBeCloseTo(110, 5);
    expect(footprint(1_000_000).waterMl).toBeCloseTo(2000, 5);
  });

  it('is zero for zero or negative tokens', () => {
    expect(footprint(0)).toEqual({ co2eGrams: 0, waterMl: 0 });
    expect(footprint(-500)).toEqual({ co2eGrams: 0, waterMl: 0 });
  });

  it('honours custom factors', () => {
    const fp = footprint(2000, { co2GramsPer1kTokens: 1, waterMlPer1kTokens: 5 });
    expect(fp.co2eGrams).toBeCloseTo(2, 5);
    expect(fp.waterMl).toBeCloseTo(10, 5);
  });

  it('exposes the per-token table defaults', () => {
    expect(DEFAULT_IMPACT_FACTORS).toEqual({ co2GramsPer1kTokens: 0.11, waterMlPer1kTokens: 2 });
  });
});
