import type {
  LocalLedgerDiagnostics,
  MaterializedUsageRecord,
  UsageObservation,
} from '@tokentama/shared-types';

/** Apply the user's durable clear watermark without mutating source files. */
export function observationsAfterClearWatermark(
  observations: readonly UsageObservation[],
  clearedBefore: string | undefined,
): UsageObservation[] {
  if (!clearedBefore) return [...observations];
  const cutoff = parseCanonicalTimestamp(clearedBefore);
  if (cutoff == null) return [...observations];
  return observations.filter((observation) => {
    const occurred = parseCanonicalTimestamp(observation.occurredAt);
    return occurred != null && occurred > cutoff;
  });
}

function parseCanonicalTimestamp(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function materializedRecordsAfterClearWatermark(
  records: readonly MaterializedUsageRecord[],
  clearedBefore: string | undefined,
): MaterializedUsageRecord[] {
  if (!clearedBefore) return [...records];
  const cutoff = parseCanonicalTimestamp(clearedBefore);
  if (cutoff == null) return [...records];
  return records.filter((record) => {
    const occurred = parseCanonicalTimestamp(record.occurredAt);
    return occurred != null && occurred > cutoff;
  });
}

export function visibleLedgerDiagnostics(
  diagnostics: LocalLedgerDiagnostics,
  records: readonly MaterializedUsageRecord[],
): LocalLedgerDiagnostics {
  const dates = records.map((record) => record.occurredAt).sort();
  return {
    ...diagnostics,
    recordCount: records.length,
    conflictingRecords: records.filter((record) => record.conflictFields.length > 0).length,
    oldestAt: dates[0],
    newestAt: dates.at(-1),
  };
}