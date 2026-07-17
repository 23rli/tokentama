import { describe, expect, it } from 'vitest';
import { materializeUsageObservations } from '../materialize';
import { observation } from './fixtures';

describe('materializeUsageObservations', () => {
  it('deduplicates rescans and merges late metered evidence over estimates', () => {
    const estimated = observation({
      observedAt: '2026-07-15T12:00:01.000Z',
      usage: {
        input: { value: 9, provenance: 'estimated' },
        output: { value: 4, provenance: 'estimated' },
        knownTotal: 0,
        partial: false,
      },
      charges: [{ unit: 'copilot-aic', value: 0.1, provenance: 'estimated' }],
    });
    const metered = observation({
      observedAt: '2026-07-15T12:00:03.000Z',
      usage: {
        input: { value: 1_000, provenance: 'metered' },
        output: { value: 100, provenance: 'metered' },
        knownTotal: 1_100,
        partial: false,
      },
      charges: [{ unit: 'copilot-aic', value: 3, provenance: 'provider-metered' }],
    });
    const result = materializeUsageObservations([estimated, estimated, metered]);
    expect(result.duplicateObservations).toBe(1);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      revisionCount: 2,
      usage: {
        input: { value: 1_000, provenance: 'metered' },
        output: { value: 100, provenance: 'metered' },
        knownTotal: 1_100,
        partial: false,
      },
      charges: [{ unit: 'copilot-aic', value: 3, provenance: 'provider-metered' }],
      conflictFields: [],
    });
  });

  it('keeps an independently metered direction and flags conflicting metered revisions', () => {
    const first = observation({
      usage: {
        input: { value: 5, provenance: 'estimated' },
        output: { value: 80, provenance: 'metered' },
        knownTotal: 80,
        partial: true,
      },
    });
    const conflict = observation({
      observedAt: '2026-07-15T12:00:04.000Z',
      usage: {
        input: { value: 5, provenance: 'estimated' },
        output: { value: 90, provenance: 'metered' },
        knownTotal: 90,
        partial: true,
      },
    });
    const record = materializeUsageObservations([first, conflict]).records[0];
    expect(record.usage.knownTotal).toBe(90);
    expect(record.usage.partial).toBe(true);
    expect(record.conflictFields).toContain('usage.output');
  });
});