import { describe, expect, it } from 'vitest';
import {
  materializedRecordsAfterClearWatermark,
  observationsAfterClearWatermark,
  visibleLedgerDiagnostics,
} from '../retention';
import { materializeUsageObservations } from '../materialize';
import { observation } from './fixtures';

describe('ledger clear watermark', () => {
  it('keeps clear durable while allowing later source observations', () => {
    const old = observation({
      sourceRecordId: 'old',
      occurredAt: '2026-07-15T09:00:00.000Z',
    });
    const fresh = observation({
      sourceRecordId: 'fresh',
      occurredAt: '2026-07-16T09:00:00.001Z',
    });
    expect(observationsAfterClearWatermark(
      [old, fresh],
      '2026-07-16T09:00:00.000Z',
    ).map((row) => row.sourceRecordId)).toEqual(['fresh']);
  });

  it('preserves all history when rebuilding removes the watermark', () => {
    const rows = [observation()];
    expect(observationsAfterClearWatermark(rows, undefined)).toEqual(rows);
    expect(observationsAfterClearWatermark(rows, 'not-a-date')).toEqual(rows);
    expect(observationsAfterClearWatermark(rows, '2026-07-16')).toEqual(rows);
  });

  it('hides stale cross-window materialized writes and adjusts visible diagnostics', () => {
    const records = materializeUsageObservations([
      observation({ sourceRecordId: 'old', occurredAt: '2026-07-15T09:00:00.000Z' }),
      observation({ sourceRecordId: 'new', occurredAt: '2026-07-16T09:00:00.001Z' }),
    ]).records;
    const visible = materializedRecordsAfterClearWatermark(
      records,
      '2026-07-16T09:00:00.000Z',
    );
    expect(visible.map((record) => record.sourceRecordId)).toEqual(['new']);
    const diagnostics = visibleLedgerDiagnostics({
      schemaVersion: 1,
      observationCount: 2,
      recordCount: 2,
      fileCount: 2,
      storageBytes: 100,
      malformedLines: 0,
      duplicateObservations: 0,
      conflictingRecords: 0,
      retention: 'until-cleared',
    }, visible);
    expect(diagnostics.recordCount).toBe(1);
    expect(diagnostics.oldestAt).toBe('2026-07-16T09:00:00.001Z');
  });
});