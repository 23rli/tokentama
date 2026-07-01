/**
 * Shared message + state contract between the extension host and the webview.
 * Types only — safe to import from both the Node host and the browser webview.
 */
import type { PetWorldState, Subscores, WasteComponent, ModelInfo, ContextSlice } from '@tokentama/shared-types';

export type { PetWorldState, Subscores, WasteComponent, ModelInfo, ContextSlice } from '@tokentama/shared-types';

/** A single scored prompt, flattened for display in the webview. */
export interface ScoredEventView {
  promptPreview: string;
  overallScore: number;
  wasteScore: number;
  delta: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
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
  inputTokens: number;
  /** Predicted likelihood this prompt needs a retry (the costliest miss). */
  retryRisk?: 'low' | 'medium' | 'high';
  retryReasons?: string[];
}

/** Result of an on-demand auto-rewrite of a compose-box draft. */
export interface AutoRewriteView {
  text: string;
  rewrittenPrompt?: string;
  estimatedTokenReductionPct?: number;
  /** True when the rewrite adds context to reduce vagueness (avoids retries). */
  clarified?: boolean;
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
