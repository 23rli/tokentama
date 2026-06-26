import * as vscode from 'vscode';
import type { GuardianStore } from '../state/guardianStore';
import type { HostMessage, WebviewMessage } from './contract';
import { buildDashboardHtml } from './html';

export interface DashboardHandlers {
  toggleCapture: () => void;
}

/** Sidebar webview that renders the guardian, metrics, and coaching panel. */
export class DashboardViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ecoprompt.dashboard';

  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: GuardianStore,
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
    // Re-send the latest state whenever the panel becomes visible again, so it
    // never shows stale data after being hidden.
    view.onDidChangeVisibility(() => {
      if (view.visible) this.post({ type: 'state', state: this.store.getState() });
    });
  }

  private onMessage(msg: WebviewMessage): void {
    switch (msg.type) {
      case 'ready':
        this.post({ type: 'state', state: this.store.getState() });
        break;
      case 'scorePrompt':
        void vscode.commands.executeCommand('ecoprompt.scorePrompt');
        break;
      case 'reset':
        this.store.reset();
        break;
      case 'toggleCapture':
        this.handlers.toggleCapture();
        break;
      case 'runDemo':
        this.post({ type: 'busy', busy: true });
        void Promise.resolve(
          vscode.commands.executeCommand('ecoprompt.runDemo'),
        ).finally(() => this.post({ type: 'busy', busy: false }));
        break;
      case 'applyTip':
        void vscode.env.clipboard.writeText(msg.rewrittenPrompt);
        this.store.markTipApplied();
        void vscode.window.showInformationMessage(
          'Rewritten prompt copied to clipboard — paste it into Copilot Chat.',
        );
        break;
      case 'copyTip':
        void vscode.env.clipboard.writeText(msg.text);
        break;
    }
  }

  private post(message: HostMessage): void {
    void this.view?.webview.postMessage(message);
  }
}
