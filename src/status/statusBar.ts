import * as vscode from 'vscode';
import type { TamaState } from '../webview/contract';

/**
 * Status-bar entry point to the Token Lens dashboard. Shows the live context load
 * (percent of the model's limit) when a forecast is available, else just the brand.
 */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.name = 'Token Lens';
    this.item.command = 'tokenlens.openDashboard';
    this.item.text = '$(graph) Token Lens';
    this.item.tooltip = 'Open Token Lens';
    this.item.show();
  }

  update(state: TamaState): void {
    const f = state.forecast;
    if (f && f.loadFraction != null) {
      const pct = Math.round(f.loadFraction * 100);
      const next = Math.round(f.predictedInputTokens).toLocaleString();
      this.item.text = `$(graph) ${pct}%`;
      this.item.tooltip = `Token Lens — context ${pct}% of limit · next turn ≈ ${next} tokens`;
    } else {
      this.item.text = '$(graph) Token Lens';
      this.item.tooltip = 'Open Token Lens';
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
