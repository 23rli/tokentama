import * as vscode from 'vscode';
import type { ScorePromptResponse, Subscores, TokenEstimate, ModelInfo } from '@tokentama/shared-types';
import { scoreToState, computeHealthUpdate, DEFAULT_HEALTH_CONFIG, type HealthModelConfig } from '@tokentama/scoring-engine';
import { classifyDifficulty } from '../analysis/taskDifficulty';
import type { OutcomeReport } from '../analysis/outcomes';
import type {
  TamaState,
  ScorePoint,
  ScoredEventView,
  TipView,
} from '../webview/contract';
import { computeMetrics, type Counters, type ScoredRecord } from '../metrics/metrics';

const STATE_KEY = 'tokentama.state.v1';
const MAX_HISTORY = 60;
const MAX_RECORDS = 200;

const FULL_SUBSCORES: Subscores = {
  promptQuality: 100,
  contextEfficiency: 100,
  toolEfficiency: 100,
  outputEfficiency: 100,
  learningAdoption: 100,
};

interface PersistShape {
  /** Session health (0..100). Reset to full on each new session, then chipped away. */
  health: number;
  /** The session whose prompts are currently draining `health`. */
  currentSessionId?: string;
  /** True while the visible score is a preliminary preview (real tokens not in yet). */
  preliminary?: boolean;
  records: ScoredRecord[];
  history: ScorePoint[];
  counters: Counters;
  lastEvent?: ScoredEventView;
  lastSubscores?: Subscores;
  tip?: TipView;
  model?: ModelInfo;
  lastOverallBySession: Record<string, number>;
  /** Cumulative tokens Tokentama itself has spent (LLM rewrites) — for net accounting. */
  toolTokensSpent: number;
  /** Most recent finalized events (newest first) so a prompt doesn't vanish from view. */
  recentEvents?: ScoredEventView[];
}

export interface RecordScoreOptions {
  sessionId: string;
  source: 'manual' | 'copilot';
  promptText: string;
  tip?: TipView;
  /** Authoritative token estimate from the captured event (carries real credits). */
  tokens?: TokenEstimate;
  /** The session's selected model + pricing, when known. */
  model?: ModelInfo;
  /** Demo/testing override: set health directly instead of running the health model. */
  forceHealth?: number;
}

/**
 * Single source of truth for the Tokentama ecosystem state. Persists to globalState,
 * runs the session health model so the pet drains/recovers with prompt efficiency,
 * and emits a full snapshot for the webview + status bar on every change.
 */
export class TamaStore {
  private readonly _onDidChange = new vscode.EventEmitter<TamaState>();
  readonly onDidChange = this._onDidChange.event;

  private data: PersistShape;
  private _captureEnabled: boolean;
  private outcomesProvider?: () => OutcomeReport;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.data = context.globalState.get<PersistShape>(STATE_KEY) ?? TamaStore.empty();
    this._captureEnabled = vscode.workspace
      .getConfiguration('tokentama.passiveCapture')
      .get<boolean>('enabled', true);
  }

  private static empty(): PersistShape {
    return {
      health: 100,
      records: [],
      history: [],
      counters: { tipsShown: 0, tipsApplied: 0 },
      lastOverallBySession: {},
      toolTokensSpent: 0,
    };
  }

  get captureEnabled(): boolean {
    return this._captureEnabled;
  }

  async setCaptureEnabled(enabled: boolean): Promise<void> {
    this._captureEnabled = enabled;
    await vscode.workspace
      .getConfiguration('tokentama.passiveCapture')
      .update('enabled', enabled, vscode.ConfigurationTarget.Global);
    this.emit();
  }

  latestOverall(sessionId: string): number | null {
    const v = this.data.lastOverallBySession[sessionId];
    return typeof v === 'number' ? v : null;
  }

  /** The current session's model, without recomputing the full state snapshot. */
  currentModel(): ModelInfo | undefined {
    return this.data.model;
  }

  /** Record tokens Tokentama itself spent (e.g. an LLM rewrite call). */
  addToolSpend(tokens: number): void {
    if (!(tokens > 0)) return;
    this.data.toolTokensSpent = (this.data.toolTokensSpent ?? 0) + Math.round(tokens);
    this.persist();
  }

  /** Cumulative tokens Tokentama has spent operating. */
  toolSpend(): number {
    return this.data.toolTokensSpent ?? 0;
  }

  /** Provide a lazy outcomes computation (from the corpus), read on each getState. */
  setOutcomesProvider(fn: () => OutcomeReport): void {
    this.outcomesProvider = fn;
  }

  recordScore(resp: ScorePromptResponse, opts: RecordScoreOptions): void {
    // Health is scoped to the current Copilot session: a new session gives the pet
    // a fresh life (full health), then each prompt's efficiency chips away at it.
    const sameSession = this.data.currentSessionId === opts.sessionId;
    const prevHealth = sameSession ? this.data.health : 100;
    const update = computeHealthUpdate(prevHealth, resp, this.healthConfig());
    this.data.currentSessionId = opts.sessionId;
    this.data.health = opts.forceHealth !== undefined ? opts.forceHealth : update.health;

    const tokens = opts.tokens ?? resp.tokens;
    const event: ScoredEventView = {
      promptPreview: opts.promptText.replace(/\s+/g, ' ').trim().slice(0, 180),
      overallScore: resp.overallScore,
      wasteScore: resp.wasteScore,
      delta: resp.delta,
      inputTokens: tokens?.inputTokens ?? 0,
      outputTokens: tokens?.outputTokens ?? 0,
      estimatedCostUsd: tokens?.estimatedCostUsd ?? 0,
      estimatedCredits: tokens?.estimatedCredits,
      copilotCredits: tokens?.copilotCredits,
      tokensReal: tokens ? !tokens.estimated : false,
      contextBreakdown: tokens?.contextBreakdown,
      wasteBreakdown: resp.wasteBreakdown,
      reasons: resp.reasons,
      improvements: resp.improvements,
      timestamp: new Date().toISOString(),
      source: opts.source,
      efficiency: Math.round(update.efficiency),
      difficulty: classifyDifficulty(opts.promptText).level,
    };

    this.data.lastEvent = event;
    this.data.recentEvents = [event, ...(this.data.recentEvents ?? [])].slice(0, 6);
    this.data.lastSubscores = resp.subscores;
    this.data.tip = opts.tip;
    if (opts.model) this.data.model = opts.model;
    this.data.lastOverallBySession[opts.sessionId] = resp.overallScore;
    this.data.preliminary = false;

    this.data.records.push({
      timestamp: event.timestamp,
      overallScore: resp.overallScore,
      wasteScore: resp.wasteScore,
      promptQuality: resp.subscores.promptQuality,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      costUsd: event.estimatedCostUsd,
      credits: event.copilotCredits ?? 0,
      estCredits: tokens?.estimatedCredits ?? 0,
      delta: resp.delta,
    });
    if (this.data.records.length > MAX_RECORDS) this.data.records.shift();

    this.data.history.push({
      t: Date.now(),
      overallScore: resp.overallScore,
      wasteScore: resp.wasteScore,
    });
    if (this.data.history.length > MAX_HISTORY) this.data.history.shift();

    if (opts.tip) this.data.counters.tipsShown += 1;

    this.persist();
  }

  markTipApplied(): void {
    this.data.counters.tipsApplied += 1;
    this.persist();
  }
  /**
   * Show a preliminary score for a turn whose real metered tokens haven't landed
   * yet. Updates only the visible score/tip — health, history, records and retry
   * context are left untouched so the authoritative recordScore() (run once the
   * turn finalizes) is the single source that chips the pet's health.
   */
  previewScore(resp: ScorePromptResponse, opts: RecordScoreOptions): void {
    const efficiency = computeHealthUpdate(this.data.health, resp, this.healthConfig()).efficiency;
    const tokens = opts.tokens ?? resp.tokens;
    this.data.lastEvent = {
      promptPreview: opts.promptText.replace(/\s+/g, ' ').trim().slice(0, 180),
      overallScore: resp.overallScore,
      wasteScore: resp.wasteScore,
      delta: resp.delta,
      inputTokens: tokens?.inputTokens ?? 0,
      outputTokens: tokens?.outputTokens ?? 0,
      estimatedCostUsd: tokens?.estimatedCostUsd ?? 0,
      estimatedCredits: tokens?.estimatedCredits,
      copilotCredits: tokens?.copilotCredits,
      tokensReal: false,
      contextBreakdown: tokens?.contextBreakdown,
      wasteBreakdown: resp.wasteBreakdown,
      reasons: resp.reasons,
      improvements: resp.improvements,
      timestamp: new Date().toISOString(),
      source: opts.source,
      efficiency: Math.round(efficiency),
      difficulty: classifyDifficulty(opts.promptText).level,
    };
    this.data.lastSubscores = resp.subscores;
    this.data.tip = opts.tip;
    if (opts.model) this.data.model = opts.model;
    this.data.preliminary = true;
    this.emit();
  }

  reset(): void {
    this.data = TamaStore.empty();
    this.persist();
  }

  private healthConfig(): HealthModelConfig {
    const cfg = vscode.workspace.getConfiguration('tokentama.health');
    return {
      maxDamage: cfg.get<number>('maxDamage', DEFAULT_HEALTH_CONFIG.maxDamage),
      healRate: cfg.get<number>('healRate', DEFAULT_HEALTH_CONFIG.healRate),
      healThreshold: cfg.get<number>('healThreshold', DEFAULT_HEALTH_CONFIG.healThreshold),
      baselineCostUsd: cfg.get<number>('baselineCostUsd', DEFAULT_HEALTH_CONFIG.baselineCostUsd),
      maxIntensity: cfg.get<number>('maxIntensity', DEFAULT_HEALTH_CONFIG.maxIntensity),
    };
  }

  getState(): TamaState {
    const cfg = vscode.workspace.getConfiguration('tokentama.sustainability');
    const impactCfg = vscode.workspace.getConfiguration('tokentama.impact');
    const metrics = computeMetrics(this.data.records, this.data.counters, {
      whPerThousandTokens: cfg.get<number>('whPerThousandTokens', 0.4),
      gridGramsCo2PerKwh: cfg.get<number>('gridGramsCo2PerKwh', 400),
      co2GramsPer1kTokens: impactCfg.get<number>('co2GramsPer1kTokens', 0.11),
      waterMlPer1kTokens: impactCfg.get<number>('waterMlPer1kTokens', 2),
      usdPerCredit: impactCfg.get<number>('usdPerCredit', 0),
    });

    return {
      world: scoreToState(this.data.health),
      health: Math.round(this.data.health),
      overallScore: this.data.lastEvent?.overallScore ?? Math.round(this.data.health),
      wasteScore: this.data.lastEvent?.wasteScore ?? 0,
      subscores: this.data.lastSubscores ?? FULL_SUBSCORES,
      lastEvent: this.data.lastEvent,
      tip: this.data.tip,
      history: this.data.history,
      metrics,
      model: this.data.model,
      captureEnabled: this._captureEnabled,
      preliminary: this.data.preliminary ?? false,
      outcomes: this.outcomesProvider?.(),
      recentEvents: this.data.recentEvents ?? [],
    };
  }

  private persist(): void {
    void this.context.globalState.update(STATE_KEY, this.data);
    this.emit();
  }

  private emit(): void {
    this._onDidChange.fire(this.getState());
  }
}
