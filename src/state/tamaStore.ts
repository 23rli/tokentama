import * as vscode from 'vscode';
import type { ScorePromptResponse, Subscores, TokenEstimate, ModelInfo } from '@tokentama/shared-types';
import { scoreToState } from '@tokentama/scoring-engine';
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
  /** Smoothed ecosystem health (EMA of overall score). */
  health: number;
  records: ScoredRecord[];
  history: ScorePoint[];
  counters: Counters;
  lastEvent?: ScoredEventView;
  lastSubscores?: Subscores;
  tip?: TipView;
  model?: ModelInfo;
  lastOverallBySession: Record<string, number>;
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
  /** Demo/testing override: set health directly instead of smoothing (EMA). */
  forceHealth?: number;
}

/**
 * Single source of truth for the Tokentama ecosystem state. Persists to globalState,
 * smooths health so the pet transitions gradually, and emits a full snapshot
 * for the webview + status bar on every change.
 */
export class TamaStore {
  private readonly _onDidChange = new vscode.EventEmitter<TamaState>();
  readonly onDidChange = this._onDidChange.event;

  private data: PersistShape;
  private _captureEnabled: boolean;

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

  recordScore(resp: ScorePromptResponse, opts: RecordScoreOptions): void {
    const prev = this.data.health;
    this.data.health =
      opts.forceHealth !== undefined ? opts.forceHealth : prev * 0.6 + resp.overallScore * 0.4;

    const tokens = opts.tokens ?? resp.tokens;
    const event: ScoredEventView = {
      promptPreview: opts.promptText.replace(/\s+/g, ' ').trim().slice(0, 180),
      overallScore: resp.overallScore,
      wasteScore: resp.wasteScore,
      delta: resp.delta,
      inputTokens: tokens?.inputTokens ?? 0,
      outputTokens: tokens?.outputTokens ?? 0,
      estimatedCostUsd: tokens?.estimatedCostUsd ?? 0,
      copilotCredits: tokens?.copilotCredits,
      tokensReal: tokens ? !tokens.estimated : false,
      wasteBreakdown: resp.wasteBreakdown,
      reasons: resp.reasons,
      improvements: resp.improvements,
      timestamp: new Date().toISOString(),
      source: opts.source,
    };

    this.data.lastEvent = event;
    this.data.lastSubscores = resp.subscores;
    this.data.tip = opts.tip;
    if (opts.model) this.data.model = opts.model;
    this.data.lastOverallBySession[opts.sessionId] = resp.overallScore;

    this.data.records.push({
      timestamp: event.timestamp,
      overallScore: resp.overallScore,
      wasteScore: resp.wasteScore,
      promptQuality: resp.subscores.promptQuality,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      costUsd: event.estimatedCostUsd,
      credits: event.copilotCredits ?? 0,
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

  reset(): void {
    this.data = TamaStore.empty();
    this.persist();
  }

  getState(): TamaState {
    const cfg = vscode.workspace.getConfiguration('tokentama.sustainability');
    const impactCfg = vscode.workspace.getConfiguration('tokentama.impact');
    const metrics = computeMetrics(this.data.records, this.data.counters, {
      whPerThousandTokens: cfg.get<number>('whPerThousandTokens', 0.4),
      gridGramsCo2PerKwh: cfg.get<number>('gridGramsCo2PerKwh', 400),
      co2GramsPer1kTokens: impactCfg.get<number>('co2GramsPer1kTokens', 0.11),
      waterMlPer1kTokens: impactCfg.get<number>('waterMlPer1kTokens', 2),
    });

    return {
      world: scoreToState(this.data.health),
      overallScore: this.data.lastEvent?.overallScore ?? Math.round(this.data.health),
      wasteScore: this.data.lastEvent?.wasteScore ?? 0,
      subscores: this.data.lastSubscores ?? FULL_SUBSCORES,
      lastEvent: this.data.lastEvent,
      tip: this.data.tip,
      history: this.data.history,
      metrics,
      model: this.data.model,
      captureEnabled: this._captureEnabled,
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
