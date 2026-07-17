import * as vscode from 'vscode';
import type { ModelInfo, PersonalLedgerOverview } from '@tokentama/shared-types';
import type {
  TamaState,
  ForecastView,
  SuccessMetrics,
  BusinessActivityScopes,
} from '../webview/contract';
import { createBusinessToolRegistry } from '../analysis/businessToolGroups';

/**
 * Minimal state carrier for Token Lens. Holds the capture toggle, the active
 * model, and the live disk-read forecast, and emits a full snapshot to the
 * webview + status bar on every change. (The pre-pivot pet/health/scoring state
 * has been removed — the dashboard is driven entirely by the on-disk forecast.)
 */
export class TamaStore implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<TamaState>();
  readonly onDidChange = this._onDidChange.event;

  private _captureEnabled: boolean;
  private model?: ModelInfo;
  private forecast?: ForecastView;
  private businessActivity?: BusinessActivityScopes;
  private personalLedger?: PersonalLedgerOverview;

  constructor() {
    this._captureEnabled = vscode.workspace
      .getConfiguration('tokenlens.passiveCapture')
      .get<boolean>('enabled', true);
  }

  get captureEnabled(): boolean {
    return this._captureEnabled;
  }

  async setCaptureEnabled(enabled: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration('tokenlens.passiveCapture')
      .update('enabled', enabled, vscode.ConfigurationTarget.Global);
    this.syncCaptureEnabled(enabled);
  }

  /** Apply a setting changed outside the dashboard without writing it back again. */
  syncCaptureEnabled(enabled: boolean): void {
    if (this._captureEnabled === enabled) return;
    this._captureEnabled = enabled;
    this.emit();
  }

  /** Update the live next-turn forecast (precognition) + active model; refresh UI. */
  setForecast(
    forecast: ForecastView,
    model?: ModelInfo,
    businessActivity?: BusinessActivityScopes,
  ): void {
    this.forecast = forecast;
    // Clear the previous chat's model when the new chat has no model metadata.
    this.model = model;
    this.businessActivity = businessActivity;
    this.emit();
  }

  /** Remove a snapshot that no longer has an in-scope chat behind it. */
  clearForecast(): void {
    this.forecast = undefined;
    this.model = undefined;
    this.businessActivity = undefined;
    this.emit();
  }

  /** Drop stale attribution immediately when group configuration changes. */
  clearBusinessActivity(): void {
    this.businessActivity = undefined;
    this.emit();
  }

  /** Replace the durable local-ledger query snapshot. */
  setPersonalLedger(overview: PersonalLedgerOverview): void {
    this.personalLedger = overview;
    this.emit();
  }

  /** Re-emit the current state so the webview's live indicator stays fresh when idle. */
  ping(): void {
    this.emit();
  }

  getState(): TamaState {
    const tokenRate = vscode.workspace
      .getConfiguration('tokenlens.impact')
      .get<number>('usdPerMillionTokens', 0.58);
    const creditRate = vscode.workspace
      .getConfiguration('tokenlens.impact')
      .get<number>('usdPerCredit', 0);
    // Zero-state fallback metrics; ImpactTrio prefers the whole-chat forecast
    // totals when present, so these only show before a forecast lands.
    const metrics: SuccessMetrics = {
      totalTokens: 0,
      totalCostUsd: 0,
      totalCredits: 0,
      totalCreditsEstimated: true,
      hasUsdRate: tokenRate > 0 || creditRate > 0,
    };
    const businessConfig = vscode.workspace.getConfiguration('tokenlens.businessTools');
    const businessRegistry = createBusinessToolRegistry(
      businessConfig.get('enabled', false),
      businessConfig.get('enabledGroups', []),
      businessConfig.get('customGroups', {}),
    );
    return {
      metrics,
      model: this.model,
      captureEnabled: this._captureEnabled,
      personalLedger: this.personalLedger,
      businessTools: {
        trackingEnabled: businessRegistry.enabled,
        groups: businessRegistry.groups,
        activity: this.businessActivity,
      },
      forecast: this.forecast,
    };
  }

  private emit(): void {
    this._onDidChange.fire(this.getState());
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
