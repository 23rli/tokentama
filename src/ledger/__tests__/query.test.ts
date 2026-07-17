import { describe, expect, it } from 'vitest';
import type { LocalLedgerDiagnostics, UsageSourceHealth } from '@tokentama/shared-types';
import { buildPersonalLedgerOverview } from '../query';
import { materializeUsageObservations } from '../materialize';
import { observation } from './fixtures';

const diagnostics: LocalLedgerDiagnostics = {
  schemaVersion: 1,
  observationCount: 3,
  recordCount: 3,
  fileCount: 1,
  storageBytes: 100,
  malformedLines: 0,
  duplicateObservations: 0,
  conflictingRecords: 0,
  retention: 'until-cleared',
};
const source: UsageSourceHealth = {
  adapterId: 'test-adapter',
  applicationName: 'Test AI',
  status: 'ready',
  sessionCount: 1,
  capabilities: { tokens: true, nativeCharges: true, tools: true, perToolTokens: false },
};

describe('buildPersonalLedgerOverview', () => {
  it('builds personal time scopes, dimensions, coverage, and metadata-only activity', () => {
    const records = materializeUsageObservations([
      observation({ occurredAt: '2026-07-16T09:00:00.000Z' }),
      observation({
        sourceRecordId: 'record-2',
        occurredAt: '2026-07-12T09:00:00.000Z',
        project: { key: 'project-2', name: 'Project Two' },
        model: { id: 'model-2', name: 'Model Two' },
        usage: {
          input: { value: 5, provenance: 'estimated' },
          output: { value: 80, provenance: 'metered' },
          knownTotal: 80,
          partial: true,
        },
      }),
      observation({
        sourceRecordId: 'record-3',
        occurredAt: '2026-05-01T09:00:00.000Z',
      }),
    ]).records;
    const overview = buildPersonalLedgerOverview(records, diagnostics, [source], {
      usdPerMillionTokens: 1,
      usdPerCredit: 0,
      now: new Date('2026-07-16T12:00:00.000Z'),
    });
    expect(overview.scopes.today.records).toBe(1);
    expect(overview.scopes['7d'].records).toBe(2);
    expect(overview.scopes['30d'].records).toBe(2);
    expect(overview.scopes.all.records).toBe(3);
    expect(overview.scopes.all.totalTokens).toBe(320);
    expect(overview.scopes.all.partialRecords).toBe(1);
    expect(overview.scopes.all.byModel.map((row) => row.name)).toContain('Model Two');
    expect(overview.scopes.all.byProvider.map((row) => row.name)).toEqual(['Test Provider']);
    expect(overview.scopes.all.byProject).toHaveLength(2);
    expect(JSON.stringify(overview.recent)).not.toContain('promptText');
    expect(overview.sources[0].capabilities.perToolTokens).toBe(false);
  });

  it('separates true pending from completed output-only and usage-unavailable records', () => {
    const records = materializeUsageObservations([
      observation({
        sourceRecordId: 'output-only',
        usage: {
          status: 'output-only',
          input: { value: 4, provenance: 'estimated' },
          output: { value: 80, provenance: 'metered' },
          knownTotal: 80,
          partial: true,
        },
      }),
      observation({
        sourceRecordId: 'pending',
        usage: {
          status: 'pending',
          input: { value: 4, provenance: 'estimated' },
          output: { value: 2, provenance: 'estimated' },
          knownTotal: 0,
          partial: false,
        },
      }),
      observation({
        sourceRecordId: 'unavailable',
        usage: {
          status: 'unavailable',
          input: { value: 4, provenance: 'estimated' },
          output: { value: 2, provenance: 'estimated' },
          knownTotal: 0,
          partial: false,
        },
      }),
    ]).records;
    const overview = buildPersonalLedgerOverview(records, diagnostics, [source], {
      usdPerMillionTokens: 1,
      usdPerCredit: 0,
      now: new Date('2026-07-16T12:00:00.000Z'),
    });
    expect(overview.scopes.all.outputOnlyRecords).toBe(1);
    expect(overview.scopes.all.pendingRecords).toBe(1);
    expect(overview.scopes.all.unavailableRecords).toBe(1);
    expect(overview.scopes.all.partialRecords).toBe(1);
    expect(overview.recent.map((row) => row.meteringStatus).sort()).toEqual([
      'output-only',
      'pending',
      'unavailable',
    ]);
  });
});