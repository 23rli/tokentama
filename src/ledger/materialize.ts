import type {
  ChargeProvenance,
  MaterializedUsageRecord,
  NativeCharge,
  UsageAttributionEvidence,
  UsageObservation,
  UsageProvenance,
  UsageQuantity,
  UsageToolObservation,
} from '@tokentama/shared-types';

export interface MaterializationResult {
  records: MaterializedUsageRecord[];
  uniqueObservationCount: number;
  duplicateObservations: number;
}

/** Merge append-only revisions into one non-duplicated logical usage record. */
export function materializeUsageObservations(
  observations: readonly UsageObservation[],
): MaterializationResult {
  const unique = new Map<string, UsageObservation>();
  for (const observation of observations) unique.set(observation.observationId, observation);
  const groups = new Map<string, UsageObservation[]>();
  for (const observation of unique.values()) {
    const group = groups.get(observation.sourceRecordId) ?? [];
    group.push(observation);
    groups.set(observation.sourceRecordId, group);
  }

  const records = [...groups.values()]
    .map(materializeRecord)
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  return {
    records,
    uniqueObservationCount: unique.size,
    duplicateObservations: observations.length - unique.size,
  };
}

function materializeRecord(revisions: UsageObservation[]): MaterializedUsageRecord {
  revisions.sort(compareRevision);
  const latest = revisions[revisions.length - 1];
  const conflicts = new Set<string>();
  const input = chooseQuantity(revisions.map((revision) => revision.usage.input), 'usage.input', conflicts);
  const output = chooseQuantity(revisions.map((revision) => revision.usage.output), 'usage.output', conflicts);
  const charges = mergeCharges(revisions, conflicts);
  const anyMetered = input.provenance === 'metered' || output.provenance === 'metered';
  const fullyMetered = input.provenance === 'metered' && output.provenance === 'metered';

  return {
    ...latest,
    occurredAt: revisions.map((revision) => revision.occurredAt).sort()[0],
    observedAt: revisions.map((revision) => revision.observedAt).sort().at(-1)!,
    usage: {
      status: materializedStatus(input.provenance, output.provenance, latest.usage.status),
      input,
      output,
      knownTotal:
        (input.provenance === 'metered' ? input.value : 0) +
        (output.provenance === 'metered' ? output.value : 0),
      partial: anyMetered && !fullyMetered,
      breakdown: chooseBreakdown(revisions, input.provenance),
    },
    charges,
    tools: mergeTools(revisions),
    evidence: mergeEvidence(revisions),
    revisionCount: revisions.length,
    conflictFields: [...conflicts].sort(),
  };
}

function chooseQuantity(
  values: UsageQuantity[],
  field: string,
  conflicts: Set<string>,
): UsageQuantity {
  let selected = values[0] ?? { value: 0, provenance: 'unknown' as const };
  for (const value of values.slice(1)) {
    const currentRank = usageRank(selected.provenance);
    const nextRank = usageRank(value.provenance);
    if (nextRank > currentRank) selected = value;
    else if (nextRank === currentRank) {
      if (value.value !== selected.value && nextRank >= usageRank('metered')) conflicts.add(field);
      selected = value;
    }
  }
  return { ...selected, value: safeNumber(selected.value) };
}

function mergeCharges(
  revisions: UsageObservation[],
  conflicts: Set<string>,
): NativeCharge[] {
  const byUnit = new Map<string, NativeCharge>();
  for (const revision of revisions) {
    for (const charge of revision.charges) {
      const previous = byUnit.get(charge.unit);
      if (!previous || chargeRank(charge.provenance) > chargeRank(previous.provenance)) {
        byUnit.set(charge.unit, charge);
      } else if (chargeRank(charge.provenance) === chargeRank(previous.provenance)) {
        if (charge.value !== previous.value && charge.provenance === 'provider-metered') {
          conflicts.add(`charges.${charge.unit}`);
        }
        byUnit.set(charge.unit, charge);
      }
    }
  }
  return [...byUnit.values()]
    .map((charge) => ({ ...charge, value: safeNumber(charge.value) }))
    .sort((a, b) => a.unit.localeCompare(b.unit));
}

function chooseBreakdown(
  revisions: UsageObservation[],
  inputProvenance: UsageProvenance,
): UsageObservation['usage']['breakdown'] {
  if (inputProvenance !== 'metered') return undefined;
  for (let i = revisions.length - 1; i >= 0; i -= 1) {
    const breakdown = revisions[i].usage.breakdown;
    if (breakdown?.length) return breakdown;
  }
  return undefined;
}

function mergeTools(revisions: UsageObservation[]): UsageToolObservation[] {
  const tools = new Map<string, UsageToolObservation>();
  for (const revision of revisions) {
    for (const tool of revision.tools) {
      const previous = tools.get(tool.callKey);
      tools.set(tool.callKey, {
        ...previous,
        ...tool,
        success: tool.success ?? previous?.success,
        durationMs: tool.durationMs ?? previous?.durationMs,
      });
    }
  }
  return [...tools.values()].sort((a, b) => a.callKey.localeCompare(b.callKey));
}

function mergeEvidence(revisions: UsageObservation[]): UsageAttributionEvidence[] {
  const evidence = new Map<string, UsageAttributionEvidence>();
  for (const revision of revisions) {
    for (const item of revision.evidence) evidence.set(`${item.kind}:${item.value}`, item);
  }
  return [...evidence.values()].sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value),
  );
}

function compareRevision(a: UsageObservation, b: UsageObservation): number {
  return a.observedAt.localeCompare(b.observedAt) || a.observationId.localeCompare(b.observationId);
}

function usageRank(provenance: UsageProvenance): number {
  return provenance === 'metered' ? 2 : provenance === 'estimated' ? 1 : 0;
}

function chargeRank(provenance: ChargeProvenance): number {
  return provenance === 'provider-metered' ? 2 : provenance === 'estimated' ? 1 : 0;
}

function safeNumber(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function materializedStatus(
  input: UsageProvenance,
  output: UsageProvenance,
  latest: UsageObservation['usage']['status'],
): NonNullable<UsageObservation['usage']['status']> {
  const inputMetered = input === 'metered';
  const outputMetered = output === 'metered';
  if (inputMetered && outputMetered) return 'metered';
  if (inputMetered) return 'input-only';
  if (outputMetered) return 'output-only';
  return latest === 'pending' ? 'pending' : 'unavailable';
}