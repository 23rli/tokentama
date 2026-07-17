import type {
  LedgerActivityRow,
  LedgerBreakdownRow,
  LedgerTimeRange,
  LocalLedgerDiagnostics,
  MaterializedUsageRecord,
  MeteringCoverageCounts,
  PersonalLedgerOverview,
  PersonalLedgerScopeSummary,
  UsageMeteringStatus,
  UsageSourceHealth,
} from '@tokentama/shared-types';

export interface PersonalLedgerQueryOptions {
  usdPerMillionTokens: number;
  usdPerCredit: number;
  now?: Date;
  recentLimit?: number;
}

interface RecordValue {
  tokens: number;
  tokensPartial: boolean;
  meteringStatus: UsageMeteringStatus;
  nativeCredits: number;
  creditsEstimated: boolean;
  costUsd?: number;
  costPartial: boolean;
}

interface MutableBreakdown extends LedgerBreakdownRow {}

export function buildPersonalLedgerOverview(
  records: readonly MaterializedUsageRecord[],
  diagnostics: LocalLedgerDiagnostics,
  sources: readonly UsageSourceHealth[],
  options: PersonalLedgerQueryOptions,
): PersonalLedgerOverview {
  const now = options.now ?? new Date();
  const scopes = {
    today: summarize(records.filter((record) => inRange(record, 'today', now)), options),
    '7d': summarize(records.filter((record) => inRange(record, '7d', now)), options),
    '30d': summarize(records.filter((record) => inRange(record, '30d', now)), options),
    all: summarize(records, options),
  } satisfies Record<LedgerTimeRange, PersonalLedgerScopeSummary>;

  return {
    ready: true,
    generatedAt: new Date().toISOString(),
    scopes,
    recent: records.slice(0, options.recentLimit ?? 20).map((record) => activityRow(record, options)),
    sources: [...sources].sort((a, b) => a.applicationName.localeCompare(b.applicationName)),
    diagnostics,
  };
}

function summarize(
  records: readonly MaterializedUsageRecord[],
  options: PersonalLedgerQueryOptions,
): PersonalLedgerScopeSummary {
  const values = records.map((record) => valueOf(record, options));
  let fullyMeteredRecords = 0;
  let partialRecords = 0;
  let inputOnlyRecords = 0;
  let outputOnlyRecords = 0;
  let pendingRecords = 0;
  let unavailableRecords = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let nativeCredits = 0;
  let creditsEstimated = false;
  let cost = 0;
  let hasCost = false;
  let costPartial = false;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const value = values[index];
    const inputMetered = record.usage.input.provenance === 'metered';
    const outputMetered = record.usage.output.provenance === 'metered';
    switch (value.meteringStatus) {
      case 'metered':
        fullyMeteredRecords += 1;
        break;
      case 'input-only':
        inputOnlyRecords += 1;
        partialRecords += 1;
        break;
      case 'output-only':
        outputOnlyRecords += 1;
        partialRecords += 1;
        break;
      case 'pending':
        pendingRecords += 1;
        break;
      case 'unavailable':
        unavailableRecords += 1;
        break;
    }
    inputTokens += inputMetered ? record.usage.input.value : 0;
    outputTokens += outputMetered ? record.usage.output.value : 0;
    nativeCredits += value.nativeCredits;
    creditsEstimated ||= value.creditsEstimated;
    if (value.costUsd != null) {
      cost += value.costUsd;
      hasCost = true;
    }
    costPartial ||= value.costPartial;
  }
  if (records.some((record) =>
    record.source.applicationId === 'github-copilot-chat' &&
    !record.charges.some((charge) => charge.unit === 'copilot-aic'),
  )) {
    creditsEstimated = true;
  }
  return {
    records: records.length,
    fullyMeteredRecords,
    partialRecords,
    inputOnlyRecords,
    outputOnlyRecords,
    pendingRecords,
    unavailableRecords,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    tokensPartial: partialRecords > 0 || pendingRecords > 0 || unavailableRecords > 0,
    nativeCredits,
    creditsEstimated,
    costUsd: hasCost ? cost : undefined,
    costPartial,
    costBasis: costBasis(options),
    byApplication: breakdown(records, values, (record) => ({
      id: record.source.applicationId,
      name: record.source.applicationName,
    })),
    byProvider: breakdown(records, values, (record) => ({
      id: record.model?.providerId ?? record.source.providerId,
      name: record.model?.providerName ?? record.source.providerName,
    })),
    byModel: breakdown(records, values, (record) => ({
      id: `${record.model?.providerId ?? 'unknown'}/${record.model?.id ?? 'unknown'}`,
      name: record.model?.name ?? record.model?.id ?? 'Unknown model',
    })),
    byProject: breakdown(records, values, (record) => ({
      id: record.project.key,
      name: record.project.name ?? `Project ${record.project.key.slice(0, 8)}`,
    })),
  };
}

function breakdown(
  records: readonly MaterializedUsageRecord[],
  values: readonly RecordValue[],
  keyOf: (record: MaterializedUsageRecord) => { id: string; name: string },
): LedgerBreakdownRow[] {
  const rows = new Map<string, MutableBreakdown>();
  for (let index = 0; index < records.length; index += 1) {
    const key = keyOf(records[index]);
    const value = values[index];
    const row: MutableBreakdown = rows.get(key.id) ?? {
      ...key,
      records: 0,
      tokens: 0,
      tokensPartial: false,
      coverage: emptyCoverage(),
      nativeCredits: 0,
      costPartial: false,
    };
    row.records += 1;
    row.tokens += value.tokens;
    row.tokensPartial ||= value.tokensPartial;
    incrementCoverage(row.coverage, value.meteringStatus);
    row.nativeCredits += value.nativeCredits;
    if (value.costUsd != null) row.costUsd = (row.costUsd ?? 0) + value.costUsd;
    row.costPartial ||= value.costPartial;
    rows.set(key.id, row);
  }
  return [...rows.values()].sort((a, b) =>
    b.tokens - a.tokens || (b.costUsd ?? 0) - (a.costUsd ?? 0) || a.name.localeCompare(b.name),
  );
}

function activityRow(
  record: MaterializedUsageRecord,
  options: PersonalLedgerQueryOptions,
): LedgerActivityRow {
  const value = valueOf(record, options);
  const workflow = record.evidence.find((item) =>
    item.confidence === 'high' && (item.kind === 'skill' || item.kind === 'agent' || item.kind === 'prompt'),
  );
  return {
    sourceRecordId: record.sourceRecordId,
    occurredAt: record.occurredAt,
    applicationName: record.source.applicationName,
    projectName: record.project.name ?? `Project ${record.project.key.slice(0, 8)}`,
    modelName: record.model?.name ?? record.model?.id ?? 'Unknown model',
    interactionType: record.interaction.type,
    workflowName: workflow?.value,
    tokens: value.tokens,
    tokensPartial: value.tokensPartial,
    meteringStatus: value.meteringStatus,
    nativeCredits: value.nativeCredits,
    costUsd: value.costUsd,
    costPartial: value.costPartial,
  };
}

function valueOf(
  record: MaterializedUsageRecord,
  options: PersonalLedgerQueryOptions,
): RecordValue {
  const inputMetered = record.usage.input.provenance === 'metered';
  const outputMetered = record.usage.output.provenance === 'metered';
  const anyMetered = inputMetered || outputMetered;
  const fullyMetered = inputMetered && outputMetered;
  const meteringStatus = resolveMeteringStatus(record);
  const tokens =
    (inputMetered ? record.usage.input.value : 0) +
    (outputMetered ? record.usage.output.value : 0);
  const charge = record.charges.find((item) => item.unit === 'copilot-aic');
  const nativeCredits = charge?.value ?? 0;
  const creditsEstimated = charge?.provenance !== 'provider-metered';
  if (Number.isFinite(options.usdPerMillionTokens) && options.usdPerMillionTokens > 0) {
    return {
      tokens,
      tokensPartial: meteringStatus !== 'metered',
      meteringStatus,
      nativeCredits,
      creditsEstimated,
      costUsd: anyMetered ? (tokens * options.usdPerMillionTokens) / 1_000_000 : undefined,
      costPartial: !fullyMetered,
    };
  }
  if (Number.isFinite(options.usdPerCredit) && options.usdPerCredit > 0 && charge) {
    return {
      tokens,
      tokensPartial: meteringStatus !== 'metered',
      meteringStatus,
      nativeCredits,
      creditsEstimated,
      costUsd: nativeCredits * options.usdPerCredit,
      costPartial: creditsEstimated,
    };
  }
  return {
    tokens,
    tokensPartial: meteringStatus !== 'metered',
    meteringStatus,
    nativeCredits,
    creditsEstimated,
    costPartial: false,
  };
}

function costBasis(options: PersonalLedgerQueryOptions): PersonalLedgerScopeSummary['costBasis'] {
  if (Number.isFinite(options.usdPerMillionTokens) && options.usdPerMillionTokens > 0) return 'tokens';
  if (Number.isFinite(options.usdPerCredit) && options.usdPerCredit > 0) return 'copilot-aic';
  return 'unconfigured';
}

function inRange(record: MaterializedUsageRecord, range: LedgerTimeRange, now: Date): boolean {
  if (range === 'all') return true;
  const occurred = Date.parse(record.occurredAt);
  if (Number.isNaN(occurred)) return false;
  const start = new Date(now);
  if (range === 'today') start.setHours(0, 0, 0, 0);
  else {
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (range === '7d' ? 6 : 29));
  }
  return occurred >= start.getTime() && occurred <= now.getTime();
}

function resolveMeteringStatus(record: MaterializedUsageRecord): UsageMeteringStatus {
  if (record.usage.status) return record.usage.status;
  const inputMetered = record.usage.input.provenance === 'metered';
  const outputMetered = record.usage.output.provenance === 'metered';
  if (inputMetered && outputMetered) return 'metered';
  if (inputMetered) return 'input-only';
  if (outputMetered) return 'output-only';
  return 'unavailable';
}

function emptyCoverage(): MeteringCoverageCounts {
  return { metered: 0, inputOnly: 0, outputOnly: 0, pending: 0, unavailable: 0 };
}

function incrementCoverage(
  coverage: MeteringCoverageCounts,
  status: UsageMeteringStatus,
): void {
  switch (status) {
    case 'metered': coverage.metered += 1; break;
    case 'input-only': coverage.inputOnly += 1; break;
    case 'output-only': coverage.outputOnly += 1; break;
    case 'pending': coverage.pending += 1; break;
    case 'unavailable': coverage.unavailable += 1; break;
  }
}