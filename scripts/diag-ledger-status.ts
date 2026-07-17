import { getWorkspaceStorageRoot, listCopilotSessions } from '../src/capture/copilotPaths';
import { LocalUsageLedger } from '../src/ledger/LocalUsageLedger';
import { buildLedgerCsvExport } from '../src/ledger/export';
import { materializeUsageObservations } from '../src/ledger/materialize';
import { CopilotUsageAdapter } from '../src/sources/copilot/CopilotUsageAdapter';

async function main(): Promise<void> {
  const root = getWorkspaceStorageRoot();
  const sessions = listCopilotSessions(root);
  const adapter = new CopilotUsageAdapter(root);
  const scan = await adapter.scan(sessions);
  const materialized = materializeUsageObservations(scan.observations);
  const ledgerRoot = process.env.TOKENLENS_LEDGER_ROOT;
  const stored = ledgerRoot
    ? await new LocalUsageLedger(ledgerRoot).materialize()
    : undefined;
  console.log(JSON.stringify({
    sourceProjection: {
      sessions: sessions.length,
      observations: scan.observations.length,
      records: materialized.records.length,
      health: scan.health.status,
      statuses: countStatuses(materialized.records),
    },
    storedLedger: stored && {
      observations: stored.diagnostics.observationCount,
      records: stored.diagnostics.recordCount,
      files: stored.diagnostics.fileCount,
      malformedLines: stored.diagnostics.malformedLines,
      statuses: countStatuses(stored.records),
      privacy: auditPrivacy(stored.records, buildLedgerCsvExport(stored.records)),
    },
  }, null, 2));
}

function auditPrivacy(records: readonly unknown[], csv: string) {
  const forbiddenKeys = new Set([
    'promptText',
    'responseText',
    'toolArguments',
    'rawPath',
    'userId',
    'machineId',
  ]);
  let forbiddenKeyHits = 0;
  let rawPathValueHits = 0;
  let localIdentityValueHits = 0;
  const identities = [process.env.USERNAME, process.env.COMPUTERNAME]
    .filter((value): value is string => !!value && value.length >= 3)
    .map((value) => value.toLowerCase());
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (/^(?:file:|[a-z]:[\\/]|\/(?:users|home)\/)/i.test(value)) rawPathValueHits += 1;
      if (identities.some((identity) => value.toLowerCase().includes(identity))) {
        localIdentityValueHits += 1;
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) forbiddenKeyHits += 1;
      visit(child);
    }
  };
  visit(records);
  return {
    forbiddenKeyHits,
    rawPathValueHits,
    localIdentityValueHits,
    csvHasContentColumns: /(?:prompt|response|code|document|tool_arguments|raw_path)_/i.test(
      csv.split(/\r?\n/, 1)[0] ?? '',
    ),
    csvHasMeteringStatus: csv.split(/\r?\n/, 1)[0]?.includes('metering_status') ?? false,
  };
}

function countStatuses(records: readonly { usage: { status?: string } }[]) {
  const statuses = new Map<string, number>();
  for (const record of records) {
    const status = record.usage.status ?? 'legacy-unspecified';
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
  }
  return [...statuses.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => a.status.localeCompare(b.status));
}

void main();
