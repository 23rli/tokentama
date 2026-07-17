/** User-supplied marginal-cost assumptions for a business service or exact tool. */
export interface BusinessToolRate {
  usdPerCall?: number;
  usdPerMinute?: number;
}

export type BusinessToolRates = Record<string, BusinessToolRate>;

/** A built-in or user-defined classification group available in settings. */
export interface BusinessToolGroupInfo {
  id: string;
  name: string;
  description: string;
  source: 'built-in' | 'custom';
  enabled: boolean;
}

/** Aggregated usage for one external service observed through an MCP tool call. */
export interface BusinessServiceUsage {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  calls: number;
  successfulCalls: number;
  failedCalls: number;
  durationMs: number;
  pricedCalls: number;
  /** Known/configured marginal cost. Undefined means every call is unpriced. */
  estimatedCostUsd?: number;
}

export type BusinessWorkflowKind = 'skill' | 'prompt' | 'agent' | 'general';

/** AI and tool activity attributed to one explicit workflow for comparison. */
export interface BusinessWorkflowUsage {
  id: string;
  name: string;
  kind: BusinessWorkflowKind;
  turns: number;
  toolCalls: number;
  businessCalls: number;
  unpricedCalls: number;
  aiCostUsd?: number;
  /** True when the active cost basis is incomplete (token direction or credit meter). */
  aiCostPartial?: boolean;
  externalCostUsd: number;
}

export interface BusinessSkillUsage {
  name: string;
  invocations: number;
}

export type BusinessAttributionBasis =
  | 'explicit-workflow'
  | 'tool-associated'
  | 'mixed'
  | 'other';

export type BusinessAttributionConfidence =
  | 'high'
  | 'medium'
  | 'low'
  | 'unattributed';

/**
 * Mutually exclusive attribution of whole Copilot requests. This deliberately
 * avoids pretending that tokens can be split among individual MCP calls.
 */
export interface BusinessAttributionUsage {
  id: string;
  name: string;
  groupId?: string;
  basis: BusinessAttributionBasis;
  confidence: BusinessAttributionConfidence;
  turns: number;
  meteredTurns: number;
  mcpCalls: number;
  /** Sum of independently metered input/output directions for assigned turns. */
  tokens: number;
  tokensPartial: boolean;
  aiCostUsd?: number;
  aiCostPartial?: boolean;
}

/** Local, content-free rollup of AI spend and the business tools it activated. */
export interface BusinessActivitySummary {
  turns: number;
  totalToolCalls: number;
  businessCalls: number;
  successfulBusinessCalls: number;
  failedBusinessCalls: number;
  durationMs: number;
  pricedCalls: number;
  unpricedCalls: number;
  /** Copilot cost derived with the same configured rate as the main dashboard. */
  aiCostUsd?: number;
  /** True when the active cost basis is incomplete (token direction or credit meter). */
  aiCostPartial?: boolean;
  /** Sum of only the external calls that have a configured rate. */
  externalCostUsd: number;
  /** AI cost + known external cost. Partial whenever `unpricedCalls` is non-zero. */
  trackedCostUsd?: number;
  services: BusinessServiceUsage[];
  workflows: BusinessWorkflowUsage[];
  skills: BusinessSkillUsage[];
  /** Every turn in the requested scope appears in exactly one row. */
  attribution: BusinessAttributionUsage[];
}

export interface BusinessActivityScopes {
  workspace: BusinessActivitySummary;
  session: BusinessActivitySummary;
  today: BusinessActivitySummary;
}

/** Always-available configuration plus activity when a chat has been observed. */
export interface BusinessToolsState {
  trackingEnabled: boolean;
  groups: BusinessToolGroupInfo[];
  activity?: BusinessActivityScopes;
}