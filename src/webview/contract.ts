/**
 * Shared message + state contract between the extension host and the webview.
 * Types only — safe to import from both the Node host and the browser webview.
 */
import type { ModelInfo, ContextSlice } from '@tokentama/shared-types';

export type { ModelInfo, ContextSlice } from '@tokentama/shared-types';

/** The headline cost tiles' zero-state fallback (the forecast's whole-chat totals are preferred). */
export interface SuccessMetrics {
  totalTokens: number;
  totalCostUsd: number;
  /** Sum of Copilot credits (AICs). */
  totalCredits: number;
  /** True when totalCredits is estimated (no real metered credits yet). */
  totalCreditsEstimated: boolean;
  /** True when a $ rate is configured (so $ figures are meaningful). */
  hasUsdRate: boolean;
}

/**
 * Live cost forecast for the NEXT turn ("precognition") plus the real numbers to
 * compare it against and the system's self-measured accuracy. Everything here is
 * either REAL (metered, `real*` fields) or PREDICTED (`predicted*`/interval) — the
 * UI must label which is which.
 */
export interface ForecastView {
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
  /** The biggest contributor to the next turn's cost ("what's hungry"). */
  hungriest: 'carriedContext' | 'growth' | 'draft';

  /** REAL input tokens metered on the last completed turn. */
  realLastInputTokens?: number;
  /** REAL credits metered on the last completed turn. */
  realLastCredits?: number;

  /** Self-measured accuracy score (0..100 = 100 − median % error). */
  accuracyScore: number;
  /** How many real turns the accuracy is based on. */
  accuracySamples: number;
  /** Fraction of real turns whose actual landed inside the predicted interval. */
  intervalCoverage: number;

  /** Current carried context (re-sent every turn) — the sustainability driver. */
  contextTokens: number;
  /** The model's input limit, when known. */
  contextLimit?: number;
  /** contextTokens / contextLimit, 0..1 (undefined if no limit known). */
  loadFraction?: number;
  /** Coarse sustainability band derived from load + reset risk. */
  sustainability: 'light' | 'moderate' | 'heavy' | 'critical' | 'overloaded';

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
  /** Total tokens (input + output) across every conversation in this workspace. */
  chatTotalTokens?: number;
  /** Total Copilot credits (AICs) across every conversation in this workspace. */
  chatCredits?: number;
  /** True when the whole-chat credit total is estimated rather than metered. */
  chatCreditsEstimated?: boolean;
  /** Derived $ cost for the whole-chat token total (blended $/1M-token rate). */
  chatCostUsd?: number;
  /** Every user turn (metered or still pending), oldest→newest, for the History list. */
  allTurns?: { prompt: string; tokens: number; metered: boolean }[];
}

/** Snapshot pushed to the webview + status bar. */
export interface TamaState {
  /** Zero-state cost fallback; the forecast's whole-chat totals are preferred. */
  metrics: SuccessMetrics;
  /** The active session's model + pricing/capabilities, when known. */
  model?: ModelInfo;
  captureEnabled: boolean;
  /** Live next-turn cost forecast + accuracy (precognition). */
  forecast?: ForecastView;
}

/** Messages sent host → webview. */
export type HostMessage =
  | { type: 'state'; state: TamaState }
  | { type: 'busy'; busy: boolean };

/** Messages sent webview → host. */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'toggleCapture' };
