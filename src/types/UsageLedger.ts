export const USAGE_OBSERVATION_SCHEMA_VERSION = 1 as const;

export type UsageProvenance = 'metered' | 'estimated' | 'unknown';
export type ChargeProvenance = 'provider-metered' | 'estimated' | 'unknown';
export type UsageMeteringStatus =
  | 'metered'
  | 'input-only'
  | 'output-only'
  | 'pending'
  | 'unavailable';

/** One independently evidenced usage quantity. */
export interface UsageQuantity {
  value: number;
  provenance: UsageProvenance;
}

/** Provider-native charge units, retained separately from mutable USD rates. */
export interface NativeCharge {
  unit: string;
  value: number;
  provenance: ChargeProvenance;
}

export interface UsageBreakdownItem {
  category: string;
  label: string;
  tokens: number;
  provenance: UsageProvenance;
}

export interface UsageToolObservation {
  callKey: string;
  name: string;
  kind: 'mcp' | 'local' | 'unknown';
  success?: boolean;
  durationMs?: number;
}

export interface UsageAttributionEvidence {
  kind: 'skill' | 'agent' | 'prompt' | 'tool';
  value: string;
  confidence: 'high' | 'medium';
}

/**
 * Content-free, source-neutral fact emitted by an AI application adapter.
 * Prompt/response text, code, documents, raw paths, and tool arguments are
 * intentionally absent from this contract.
 */
export interface UsageObservation {
  schemaVersion: typeof USAGE_OBSERVATION_SCHEMA_VERSION;
  /** Hash of the complete content-free observation, excluding observedAt. */
  observationId: string;
  /** Stable logical request identity across pending and metered revisions. */
  sourceRecordId: string;
  occurredAt: string;
  observedAt: string;
  source: {
    adapterId: string;
    applicationId: string;
    applicationName: string;
    providerId: string;
    providerName: string;
  };
  project: {
    /** Local pseudonymous key; never a raw workspace path. */
    key: string;
    /** Local display alias, normally the folder/workspace basename. */
    name?: string;
  };
  sessionKey: string;
  interaction: {
    type: 'chat-turn' | 'completion' | 'agent-run' | 'unknown';
    index?: number;
  };
  model?: {
    id: string;
    name?: string;
    providerId?: string;
    providerName?: string;
    reasoningEffort?: string;
  };
  usage: {
    /** Optional for backwards compatibility with early schema-v1 partitions. */
    status?: UsageMeteringStatus;
    input: UsageQuantity;
    output: UsageQuantity;
    knownTotal: number;
    partial: boolean;
    breakdown?: UsageBreakdownItem[];
  };
  charges: NativeCharge[];
  tools: UsageToolObservation[];
  evidence: UsageAttributionEvidence[];
}

/** Query-time merge of all revisions for one logical source record. */
export interface MaterializedUsageRecord extends UsageObservation {
  revisionCount: number;
  conflictFields: string[];
}

export interface UsageSourceHealth {
  adapterId: string;
  applicationName: string;
  status: 'ready' | 'empty' | 'unavailable' | 'error';
  lastScanAt?: string;
  sessionCount: number;
  detail?: string;
  capabilities: {
    tokens: boolean;
    nativeCharges: boolean;
    tools: boolean;
    perToolTokens: boolean;
  };
}

export type LedgerTimeRange = 'today' | '7d' | '30d' | 'all';

export interface MeteringCoverageCounts {
  metered: number;
  inputOnly: number;
  outputOnly: number;
  pending: number;
  unavailable: number;
}

export interface LedgerBreakdownRow {
  id: string;
  name: string;
  records: number;
  tokens: number;
  tokensPartial: boolean;
  coverage: MeteringCoverageCounts;
  nativeCredits: number;
  costUsd?: number;
  costPartial: boolean;
}

export interface LedgerActivityRow {
  sourceRecordId: string;
  occurredAt: string;
  applicationName: string;
  projectName: string;
  modelName: string;
  interactionType: string;
  workflowName?: string;
  tokens: number;
  tokensPartial: boolean;
  meteringStatus: UsageMeteringStatus;
  nativeCredits: number;
  costUsd?: number;
  costPartial: boolean;
}

export interface PersonalLedgerScopeSummary {
  records: number;
  fullyMeteredRecords: number;
  partialRecords: number;
  inputOnlyRecords: number;
  outputOnlyRecords: number;
  pendingRecords: number;
  unavailableRecords: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokensPartial: boolean;
  nativeCredits: number;
  creditsEstimated: boolean;
  costUsd?: number;
  costPartial: boolean;
  costBasis: 'tokens' | 'copilot-aic' | 'unconfigured';
  byApplication: LedgerBreakdownRow[];
  byProvider: LedgerBreakdownRow[];
  byModel: LedgerBreakdownRow[];
  byProject: LedgerBreakdownRow[];
}

export interface LocalLedgerDiagnostics {
  schemaVersion: number;
  observationCount: number;
  recordCount: number;
  fileCount: number;
  storageBytes: number;
  malformedLines: number;
  malformedFiles?: string[];
  duplicateObservations: number;
  conflictingRecords: number;
  oldestAt?: string;
  newestAt?: string;
  retention: 'until-cleared';
}

export interface PersonalLedgerOverview {
  ready: boolean;
  generatedAt: string;
  scopes: Record<LedgerTimeRange, PersonalLedgerScopeSummary>;
  recent: LedgerActivityRow[];
  sources: UsageSourceHealth[];
  diagnostics: LocalLedgerDiagnostics;
}