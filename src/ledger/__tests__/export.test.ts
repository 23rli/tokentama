import { describe, expect, it } from 'vitest';
import type { PersonalLedgerOverview } from '@tokentama/shared-types';
import { buildLedgerCsvExport, buildLedgerJsonExport } from '../export';
import { materializeUsageObservations } from '../materialize';
import { observation } from './fixtures';

const overview: PersonalLedgerOverview = {
  ready: true,
  generatedAt: '2026-07-16T12:00:00.000Z',
  scopes: {} as PersonalLedgerOverview['scopes'],
  recent: [],
  sources: [],
  diagnostics: {
    schemaVersion: 1,
    observationCount: 1,
    recordCount: 1,
    fileCount: 1,
    storageBytes: 1,
    malformedLines: 0,
    duplicateObservations: 0,
    conflictingRecords: 0,
    retention: 'until-cleared',
  },
};

describe('local ledger export', () => {
  it('exports versioned JSON with an explicit privacy contract', () => {
    const records = materializeUsageObservations([observation()]).records;
    const exported = buildLedgerJsonExport(records, overview);
    expect(exported.exportSchemaVersion).toBe(1);
    expect(exported.privacy.metadataOnly).toBe(true);
    const serialized = JSON.stringify(exported);
    for (const forbidden of ['promptText', 'responseText', 'toolArguments', 'userId', 'machineId']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('exports CSV with correct escaping and no content columns', () => {
    const records = materializeUsageObservations([
      observation({ project: { key: 'p', name: 'Quoted, "Project"' } }),
    ]).records;
    const csv = buildLedgerCsvExport(records);
    expect(csv.startsWith('\uFEFFoccurred_at')).toBe(true);
    expect(csv).toContain('"Quoted, ""Project"""');
    expect(csv).toContain('metering_status');
    expect(csv).toContain(',metered,');
    expect(csv).not.toContain('prompt_text');
    expect(csv).not.toContain('response_text');
    expect(csv.split('\r\n')).toHaveLength(2);
  });
});