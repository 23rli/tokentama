import * as vscode from 'vscode';
import type { TamaState, PetWorldState } from '../webview/contract';

const WORLD_EMOJI: Record<PetWorldState, string> = {
  thriving: '🌳',
  healthy: '🌿',
  concerned: '🍂',
  critical: '🥀',
  collapse: '🔥',
  dead: '💀',
};

/** Status-bar indicator showing the live efficiency score + ecosystem mood. */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'tokentama.openDashboard';
    this.item.show();
  }

  update(state: TamaState): void {
    const emoji = WORLD_EMOJI[state.world] ?? '🌿';
    this.item.text = `$(shield) ${emoji} ${Math.round(state.overallScore)}`;
    this.item.tooltip = `Tokentama — ${state.world} · waste ${Math.round(
      state.wasteScore,
    )} · ${state.metrics.promptsScored} scored`;
  }

  dispose(): void {
    this.item.dispose();
  }
}
