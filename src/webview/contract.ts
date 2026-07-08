/**
 * Shared message + state contract between the extension host and the webview.
 * Types only — safe to import from both the Node host and the browser webview.
 */
import type { PetWorldState, Subscores, WasteComponent, ModelInfo, ContextSlice } from '@tokentama/shared-types';
import type { OutcomeReport } from '../analysis/outcomes';

export type { PetWorldState, Subscores, WasteComponent, ModelInfo, ContextSlice } from '@tokentama/shared-types';

export type { OutcomeReport } from '../analysis/outcomes';

/** A single scored prompt, flattened for display in the webview. */
export interface ScoredEventView {
  promptPreview: string;
  overallScore: number;
  wasteScore: number;
  delta: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  /** Estimated Copilot credits (AICs) for this turn. */
  estimatedCredits?: number;
  /** Real Copilot credits for this turn, when read from disk. */
  copilotCredits?: number;
  /** True when token counts are real (from chatSessions), not estimated. */
  tokensReal?: boolean;
  /** Where this turn's input tokens went (system / tools / messages…). */
  contextBreakdown?: ContextSlice[];
  wasteBreakdown: WasteComponent[];
  reasons: string[];
  improvements: string[];
  timestamp: string;
  source: 'manual' | 'copilot';
  /** Per-prompt efficiency (0..100): waste scaled by cost/carbon intensity. */
  efficiency?: number;
  /** Estimated task difficulty, for model/effort right-sizing. */
  difficulty?: 'trivial' | 'moderate' | 'complex';
}

/** A coaching tip shown to the user. */
export interface TipView {
  message: string;
  rewrittenPrompt?: string;
  category?: string;
  /** Estimated % fewer tokens the rewrite would use. */
  estimatedTokenReductionPct?: number;
  /** Estimated % lower latency the rewrite would yield. */
  estimatedLatencyReductionPct?: number;
  /** Estimated absolute tokens saved by the rewrite for this prompt. */
  estimatedTokensSaved?: number;
}

/** Live score for a draft typed in the compose box (offline, no state change). */
export interface ComposeResult {
  text: string;
  overallScore: number;
  wasteScore: number;
  tip?: string;
  rewrittenPrompt?: string;
  estimatedTokenReductionPct?: number;
  /** Estimated number of tokens the leaner rewrite saves. */
  estimatedTokensSaved?: number;
  inputTokens: number;
  /** Predicted likelihood this prompt needs a retry (the costliest miss). */
  retryRisk?: 'low' | 'medium' | 'high';
  retryReasons?: string[];
  /** Offline corpus hint when the prompt names no target the user usually works in. */
  contextGapHint?: string;
}

/** Result of an on-demand auto-rewrite of a compose-box draft. */
export interface AutoRewriteView {
  text: string;
  rewrittenPrompt?: string;
  estimatedTokenReductionPct?: number;
  /** Estimated number of tokens the rewrite saves vs. the original. */
  estimatedTokensSaved?: number;
  source: 'offline' | 'llm' | 'none';
  examplesUsed: number;
}

/** A point on the session score trend line. */
export interface ScorePoint {
  t: number;
  overallScore: number;
  wasteScore: number;
}

/** The six headline success metrics (design doc success criteria). */
export interface SuccessMetrics {
  /** % reduction in estimated tokens across the session (baseline → latest). */
  tokenReductionPct: number;
  /** % reduction in waste score across the session. */
  wasteReductionPct: number;
  /** % improvement in prompt-quality subscore across the session. */
  promptQualityImprovementPct: number;
  /** Mean positive change in overall score per scored prompt. */
  averageScoreIncrease: number;
  /** Coaching engagement: tips applied / tips shown (0..1). */
  coachingEngagement: number;
  /** Estimated sustainability impact of tokens saved, in watt-hours. */
  sustainabilityWhSaved: number;
  /** Estimated grams CO2e avoided. */
  sustainabilityCo2eGrams: number;
  /** Raw counters backing the rates above. */
  promptsScored: number;
  tipsShown: number;
  tipsApplied: number;
  totalTokens: number;
  totalCostUsd: number;
  /** Sum of real Copilot credits across the session (0 if none were real). */
  totalCredits: number;
  /** Credits (AICs) attributable to wasteful prompting. */
  creditsWasted: number;
  /** True when totalCredits is estimated (no real metered credits yet). */
  totalCreditsEstimated: boolean;
  /** True when a USD-per-credit rate is configured (so $ figures are meaningful). */
  hasUsdRate: boolean;
  /** Absolute CO2e footprint of all tokens this session (grams). */
  co2eGramsTotal: number;
  /** Absolute water footprint of all tokens this session (millilitres). */
  waterMlTotal: number;
  /** CO2e (grams) attributable to wasteful prompting (waste-weighted). */
  co2eGramsWasted: number;
  /** Water (millilitres) attributable to wasteful prompting. */
  waterMlWasted: number;
  /** Estimated dollars attributable to wasteful prompting. */
  costUsdWasted: number;
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
}

/** Full snapshot of pet state pushed to the webview. */
export interface TamaState {
  world: PetWorldState;
  /** Current session health (0..100) that drives the pet world. */
  health: number;
  /** True while the shown score is a preliminary preview (tokens not finalized). */
  preliminary?: boolean;
  overallScore: number;
  wasteScore: number;
  subscores: Subscores;
  lastEvent?: ScoredEventView;
  tip?: TipView;
  history: ScorePoint[];
  metrics: SuccessMetrics;
  /** The session's selected model + its pricing/capabilities, when known. */
  model?: ModelInfo;
  captureEnabled: boolean;
  /** Aggregate coaching-outcome signal (retry reduction from adoption). */
  outcomes?: OutcomeReport;
  /** Most recent finalized scored events (newest first) for the recent strip. */
  recentEvents?: ScoredEventView[];
  /** Live next-turn cost forecast + accuracy (precognition). */
  forecast?: ForecastView;
}

/** Messages sent host → webview. */
export type HostMessage =
  | { type: 'state'; state: TamaState }
  | { type: 'busy'; busy: boolean }
  | { type: 'composeResult'; result: ComposeResult }
  | { type: 'autoRewriteResult'; result: AutoRewriteView };

/** Messages sent webview → host. */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'scorePrompt' }
  | { type: 'reset' }
  | { type: 'toggleCapture' }
  | { type: 'runDemo' }
  | { type: 'applyTip'; rewrittenPrompt: string }
  | { type: 'copyTip'; text: string }
  | { type: 'composeInput'; text: string }
  | { type: 'autoRewrite'; text: string }
  | { type: 'copyToCopilot'; text: string; adopted: boolean }
  | { type: 'compactSession' };
