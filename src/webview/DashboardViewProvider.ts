import * as vscode from 'vscode';
import type { TamaStore } from '../state/tamaStore';
import type { HostMessage, WebviewMessage } from './contract';
import { buildDashboardHtml } from './html';

export interface DashboardHandlers {
  toggleCapture: () => void;
  refresh: () => void;
}

/** Sidebar webview that renders the Token Lens cost + forecast dashboard. */
export class DashboardViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'tokentama.dashboard';

  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: TamaStore,
    private readonly handlers: DashboardHandlers,
  ) {
    this.store.onDidChange((state) => this.post({ type: 'state', state }));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };
    view.webview.html = buildDashboardHtml(view.webview, this.extensionUri);
    view.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg));
    // Re-send the latest state whenever the panel becomes visible again, and pull
    // a FRESH forecast from disk so it never shows a stale snapshot after being
    // hidden or after turns completed while it wasn't focused.
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.handlers.refresh();
        this.post({ type: 'state', state: this.store.getState() });
      }
    });
  }

  private onMessage(msg: WebviewMessage): void {
    switch (msg.type) {
      case 'ready':
        this.handlers.refresh();
        this.post({ type: 'state', state: this.store.getState() });
        break;
      case 'reset':
        void vscode.commands.executeCommand('tokentama.resetEcosystem');
        break;
      case 'toggleCapture':
        this.handlers.toggleCapture();
        break;
      case 'compactSession':
        void vscode.commands.executeCommand('tokentama.compactSession');
        break;
    }
  }

  private post(message: HostMessage): void {
    void this.view?.webview.postMessage(message);
  }
}
