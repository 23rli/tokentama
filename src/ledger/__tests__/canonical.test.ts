import { describe, expect, it } from 'vitest';
import { canonicalJson, finalizeUsageObservation } from '../canonical';
import { observation } from './fixtures';

describe('usage observation identity', () => {
  it('canonicalizes object key order', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      canonicalJson({ a: { b: 3, y: 2 }, z: 1 }),
    );
  });

  it('ignores observedAt while changing identity for substantive evidence', () => {
    const first = observation({ observedAt: '2026-07-15T12:00:01.000Z' });
    const { observationId: _id, ...draft } = first;
    const rescanned = finalizeUsageObservation({
      ...draft,
      observedAt: '2026-07-16T12:00:01.000Z',
    });
    const enriched = finalizeUsageObservation({
      ...draft,
      observedAt: '2026-07-16T12:00:01.000Z',
      usage: {
        ...draft.usage,
        output: { value: 30, provenance: 'metered' },
        knownTotal: 130,
      },
    });
    expect(rescanned.observationId).toBe(first.observationId);
    expect(enriched.observationId).not.toBe(first.observationId);
  });
});