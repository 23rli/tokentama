/**
 * Shared message + state contract between the extension host and the webview.
 * Types only — safe to import from both the Node host and the browser webview.
 */
import type {
  ModelInfo,
  ContextSlice,
  BusinessToolsState,
  PersonalLedgerOverview,
  UsageMeteringStatus,
} from '@tokentama/shared-types';

export type {
  ModelInfo,
  ContextSlice,
  BusinessActivityScopes,
  BusinessToolsState,
  BusinessToolGroupInfo,
  BusinessActivitySummary,
  BusinessAttributionUsage,
  BusinessServiceUsage,
  BusinessWorkflowUsage,
  PersonalLedgerOverview,
  PersonalLedgerScopeSummary,
  LedgerTimeRange,
  LedgerBreakdownRow,
  LedgerActivityRow,
  MeteringCoverageCounts,
  UsageSourceHealth,
  UsageMeteringStatus,
} from '@tokentama/shared-types';

/**
 * Live cost forecast for the next turn plus the real numbers to
 * compare it against and the system's self-measured accuracy. Everything here is
 * either REAL (metered, `real*` fields) or PREDICTED (`predicted*`/interval) — the
 * UI must label which is which.
 */
export interface ForecastView {
  /** Whether the estimate targets an in-flight prompt or the next unsent turn. */
  forecastTarget: 'pending' | 'next';
  /** PREDICTED input tokens for the next turn. */
  predictedInputTokens: number;
  /** Calibrated interval [low, high] around the prediction. */
  intervalLow: number;
  intervalHigh: number;
  /** PREDICTED Copilot credits for the next turn (cache-aware), when known. */
  predictedCredits?: number;
  /** 0..1 confidence; low → the UI should hedge. */
  confidence: number;
  /** 'high' when a summarization reset is likely (point estimate unreliable). */
  resetRisk: 'low' | 'high';

  /** REAL input tokens metered on the last completed turn. */
  realLastInputTokens?: number;
  /** REAL input + output tokens on the last completed turn. */
  realLastTotalTokens?: number;
  /** REAL credits metered on the last completed turn. */
  realLastCredits?: number;
  /** Derived USD cost for the last completed turn under the configured rate. */
  realLastCostUsd?: number;
  /** Whether the last completed turn belongs to the current local calendar day. */
  realLastIsToday?: boolean;

  /** Self-measured accuracy score (0..100 = 100 − median % error). */
  accuracyScore: number;
  /** How many real turns the accuracy is based on. */
  accuracySamples: number;
  /** Fraction of real turns whose actual landed inside the predicted interval. */
  intervalCoverage: number;

  /** Current carried context, re-sent every turn. */
  contextTokens: number;
  /** The model's input limit, when known. */
  contextLimit?: number;
  /** contextTokens / contextLimit, 0..1 (undefined if no limit known). */
  loadFraction?: number;
  /** Coarse context-load band derived from load + reset risk. */
  contextBand: 'light' | 'moderate' | 'heavy' | 'critical' | 'overloaded';

  /** Short id of the session being tracked, so the user knows WHICH chat. */
  sessionShortId?: string;
  /** The chat's display name (custom title), when set. */
  sessionTitle?: string;
  /** The last captured user prompt (truncated) — what the forecast is based on. */
  lastPromptPreview?: string;
  /** Number of real (metered) turns seen in this session. */
  turnCount: number;
  /** Real input tokens per turn, oldest→newest, for the context-growth bar graph. */
  contextSeries: number[];
  /** Prompt excerpt per turn, aligned with contextSeries, for the graph tooltip. */
  turnPrompts?: string[];
  /** Where the last real turn's input tokens went (system/tools/history/message). */
  contextBreakdown?: ContextSlice[];
  /** Total input tokens of the last real turn (denominator for the breakdown). */
  contextInputTokens?: number;
  /** Session-wide breakdown: category tokens summed across every turn. */
  sessionBreakdown?: ContextSlice[];
  /** Total input tokens summed across the whole session. */
  sessionInputTokens?: number;
  /** Whole-chat breakdown: category tokens summed across EVERY conversation in this workspace. */
  chatBreakdown?: ContextSlice[];
  /** Total input tokens summed across every conversation in this workspace. */
  chatInputTokens?: number;
  /** Number of distinct conversations aggregated into the whole-chat totals. */
  chatSessionCount?: number;
  /** What the broadest totals represent in the current capture configuration. */
  aggregateScope?: 'workspace' | 'allWindows' | 'emptyWindow';
  /** Total tokens (input + output) across every conversation in this workspace. */
  chatTotalTokens?: number;
  /** True when chatTotalTokens includes known token directions but some were unavailable. */
  chatTokensPartial?: boolean;
  /** Total Copilot credits (AICs) across every conversation in this workspace. */
  chatCredits?: number;
  /** True when the whole-chat credit total is estimated rather than metered. */
  chatCreditsEstimated?: boolean;
  /** Derived $ cost for the whole-chat token total (blended $/1M-token rate). */
  chatCostUsd?: number;
  chatCostPartial?: boolean;
  /** Total tokens (input + output) for the ACTIVE chat only. */
  sessionTotalTokens?: number;
  /** True when sessionTotalTokens is a known minimum due to incomplete metering. */
  sessionTokensPartial?: boolean;
  /** Total Copilot credits (AICs) for the active chat only. */
  sessionCredits?: number;
  /** True when the active-chat credit total is estimated rather than metered. */
  sessionCreditsEstimated?: boolean;
  /** Derived $ cost for the active chat's token total. */
  sessionCostUsd?: number;
  sessionCostPartial?: boolean;
  /** Total tokens (input + output) across turns dated today (all chats in scope). */
  todayTotalTokens?: number;
  /** True when todayTotalTokens is a known minimum due to incomplete metering. */
  todayTokensPartial?: boolean;
  /** Total Copilot credits (AICs) across today's turns. */
  todayCredits?: number;
  /** True when today's credit total is estimated rather than metered. */
  todayCreditsEstimated?: boolean;
  /** Derived $ cost for today's token total. */
  todayCostUsd?: number;
  todayCostPartial?: boolean;
  /** Every user turn (metered or still pending), oldest→newest, for the History list. */
  allTurns?: {
    prompt: string;
    tokens: number;
    metered: boolean;
    partial?: boolean;
    status: UsageMeteringStatus;
  }[];
}

/** Snapshot pushed to the webview + status bar. */
export interface TokenLensState {
  /** True when a local token or AIC dollar rate is configured. */
  hasUsdRate: boolean;
  /** The active session's model + pricing/capabilities, when known. */
  model?: ModelInfo;
  captureEnabled: boolean;
  /** Durable, metadata-only usage history across local AI application adapters. */
  personalLedger?: PersonalLedgerOverview;
  /** Independently configurable business-tool groups and their local activity. */
  businessTools: BusinessToolsState;
  /** Live next-turn cost forecast + accuracy. */
  forecast?: ForecastView;
}

/** Messages sent host → webview. */
export type HostMessage =
  | { type: 'state'; state: TokenLensState }
  | { type: 'busy'; busy: boolean };

/** Messages sent webview → host. */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'toggleCapture' }
  | { type: 'manage' }
  | { type: 'exportLedger' }
  | { type: 'openBusinessToolSettings' }
  | { type: 'setBusinessToolTracking'; enabled: boolean }
  | { type: 'setBusinessToolGroup'; groupId: string; enabled: boolean };
