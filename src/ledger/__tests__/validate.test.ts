import { describe, expect, it } from 'vitest';
import { isUsageObservation } from '../validate';
import { observation } from './fixtures';

describe('usage observation validation', () => {
  it('accepts a valid canonical observation', () => {
    expect(isUsageObservation(observation())).toBe(true);
  });

  it('rejects malformed nested provenance and fingerprint corruption', () => {
    const row = observation();
    expect(isUsageObservation({
      ...row,
      usage: { ...row.usage, input: { value: 1, provenance: 'corrupt' } },
    })).toBe(false);
    expect(isUsageObservation({ ...row, observationId: 'forged' })).toBe(false);
    expect(isUsageObservation({
      ...row,
      charges: [{ unit: 'x', value: 1, provenance: 'wrong' }],
    })).toBe(false);
  });
});