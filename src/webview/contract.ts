/**
 * Shared message + state contract between the extension host and the webview.
 * Types only — safe to import from both the Node host and the browser webview.
 */
import type { PetWorldState, Subscores, WasteComponent } from '@ecoprompt/shared-types';

export type { PetWorldState, Subscores, WasteComponent } from '@ecoprompt/shared-types';

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
  wasteBreakdown: WasteComponent[];
  reasons: string[];
  improvements: string[];
  timestamp: string;
  source: 'manual' | 'copilot';
}

/** A coaching tip shown to the user. */
export interface TipView {
  message: string;
  rewrittenPrompt?: string;
  category?: string;
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
}

/** Full snapshot of guardian state pushed to the webview. */
export interface GuardianState {
  world: PetWorldState;
  overallScore: number;
  wasteScore: number;
  subscores: Subscores;
  lastEvent?: ScoredEventView;
  tip?: TipView;
  history: ScorePoint[];
  metrics: SuccessMetrics;
  captureEnabled: boolean;
}

/** Messages sent host → webview. */
export type HostMessage =
  | { type: 'state'; state: GuardianState }
  | { type: 'busy'; busy: boolean };

/** Messages sent webview → host. */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'scorePrompt' }
  | { type: 'reset' }
  | { type: 'toggleCapture' }
  | { type: 'applyTip'; rewrittenPrompt: string }
  | { type: 'copyTip'; text: string };
