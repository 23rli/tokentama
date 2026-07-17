import { performance } from 'node:perf_hooks';
import type {
  LocalLedgerDiagnostics,
  UsageObservation,
  UsageSourceHealth,
} from '@tokentama/shared-types';
import { materializeUsageObservations } from '../src/ledger/materialize';
import { buildPersonalLedgerOverview } from '../src/ledger/query';

const observationCount = 100_000;
const recordCount = 50_000;
const observations: UsageObservation[] = [];
const baseMs = Date.parse('2026-01-01T00:00:00.000Z');
for (let index = 0; index < observationCount; index += 1) {
  const logical = index % recordCount;
  const revision = index < recordCount ? 0 : 1;
  const occurredAt = new Date(baseMs + logical * 60_000).toISOString();
  observations.push({
    schemaVersion: 1,
    observationId: `observation-${index}`,
    sourceRecordId: `record-${logical}`,
    occurredAt,
    observedAt: new Date(baseMs + logical * 60_000 + revision * 1_000).toISOString(),
    source: {
      adapterId: 'benchmark',
      applicationId: logical % 2 ? 'app-a' : 'app-b',
      applicationName: logical % 2 ? 'AI App A' : 'AI App B',
      providerId: logical % 3 ? 'provider-a' : 'provider-b',
      providerName: logical % 3 ? 'Provider A' : 'Provider B',
    },
    project: { key: `project-${logical % 20}`, name: `Project ${logical % 20}` },
    sessionKey: `session-${Math.floor(logical / 20)}`,
    interaction: { type: 'chat-turn', index: logical % 100 },
    model: { id: `model-${logical % 5}`, name: `Model ${logical % 5}` },
    usage: revision === 0
      ? {
          input: { value: 25, provenance: 'estimated' },
          output: { value: 10, provenance: 'estimated' },
          knownTotal: 0,
          partial: false,
        }
      : {
          input: { value: 1_000 + logical % 10_000, provenance: 'metered' },
          output: { value: 100 + logical % 1_000, provenance: 'metered' },
          knownTotal: 1_100 + logical % 10_000 + logical % 1_000,
          partial: false,
        },
    charges: revision === 0
      ? [{ unit: 'credits', value: 0.1, provenance: 'estimated' }]
      : [{ unit: 'credits', value: 1 + logical % 100, provenance: 'provider-metered' }],
    tools: [],
    evidence: [],
  });
}

const materializeStart = performance.now();
const materialized = materializeUsageObservations(observations);
const materializeMs = performance.now() - materializeStart;
const diagnostics: LocalLedgerDiagnostics = {
  schemaVersion: 1,
  observationCount,
  recordCount: materialized.records.length,
  fileCount: 10,
  storageBytes: 0,
  malformedLines: 0,
  duplicateObservations: materialized.duplicateObservations,
  conflictingRecords: 0,
  retention: 'until-cleared',
};
const source: UsageSourceHealth = {
  adapterId: 'benchmark',
  applicationName: 'Benchmark',
  status: 'ready',
  sessionCount: 2_500,
  capabilities: { tokens: true, nativeCharges: true, tools: true, perToolTokens: false },
};

// Warm once, then report the common cached/materialized Overview query.
buildPersonalLedgerOverview(materialized.records, diagnostics, [source], {
  usdPerMillionTokens: 0.58,
  usdPerCredit: 0,
  now: new Date('2026-03-01T00:00:00.000Z'),
});
const queryStart = performance.now();
const overview = buildPersonalLedgerOverview(materialized.records, diagnostics, [source], {
  usdPerMillionTokens: 0.58,
  usdPerCredit: 0,
  now: new Date('2026-03-01T00:00:00.000Z'),
});
const queryMs = performance.now() - queryStart;

console.log(JSON.stringify({
  observationCount,
  recordCount: materialized.records.length,
  materializeMs: Math.round(materializeMs * 10) / 10,
  overviewQueryMs: Math.round(queryMs * 10) / 10,
  applications: overview.scopes.all.byApplication.length,
  models: overview.scopes.all.byModel.length,
  projects: overview.scopes.all.byProject.length,
}, null, 2));
