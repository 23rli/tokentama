import * as vscode from 'vscode';
import type { ModelInfo } from '@tokentama/shared-types';
import type { TamaState, ForecastView, SuccessMetrics } from '../webview/contract';

/**
 * Minimal state carrier for Token Lens. Holds the capture toggle, the active
 * model, and the live disk-read forecast, and emits a full snapshot to the
 * webview + status bar on every change. (The pre-pivot pet/health/scoring state
 * has been removed — the dashboard is driven entirely by the on-disk forecast.)
 */
export class TamaStore {
  private readonly _onDidChange = new vscode.EventEmitter<TamaState>();
  readonly onDidChange = this._onDidChange.event;

  private _captureEnabled: boolean;
  private model?: ModelInfo;
  private forecast?: ForecastView;

  constructor() {
    this._captureEnabled = vscode.workspace
      .getConfiguration('tokenlens.passiveCapture')
      .get<boolean>('enabled', true);
  }

  get captureEnabled(): boolean {
    return this._captureEnabled;
  }

  async setCaptureEnabled(enabled: boolean): Promise<void> {
    this._captureEnabled = enabled;
    await vscode.workspace
      .getConfiguration('tokenlens.passiveCapture')
      .update('enabled', enabled, vscode.ConfigurationTarget.Global);
    this.emit();
  }

  /** Update the live next-turn forecast (precognition) + active model; refresh UI. */
  setForecast(forecast: ForecastView, model?: ModelInfo): void {
    this.forecast = forecast;
    if (model) this.model = model;
    this.emit();
  }

  /** Re-emit the current state so the webview's live indicator stays fresh when idle. */
  ping(): void {
    this.emit();
  }

  getState(): TamaState {
    const rate = vscode.workspace
      .getConfiguration('tokenlens.impact')
      .get<number>('usdPerMillionTokens', 0.58);
    // Zero-state fallback metrics; ImpactTrio prefers the whole-chat forecast
    // totals when present, so these only show before a forecast lands.
    const metrics: SuccessMetrics = {
      totalTokens: 0,
      totalCostUsd: 0,
      totalCredits: 0,
      totalCreditsEstimated: true,
      hasUsdRate: rate > 0,
    };
    return {
      metrics,
      model: this.model,
      captureEnabled: this._captureEnabled,
      forecast: this.forecast,
    };
  }

  private emit(): void {
    this._onDidChange.fire(this.getState());
  }
}
