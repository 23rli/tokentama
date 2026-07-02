import * as vscode from 'vscode';
import type { TamaStore } from '../state/tamaStore';
import type { AutoRewriteView, ComposeResult, HostMessage, WebviewMessage } from './contract';
import { buildDashboardHtml } from './html';

export interface DashboardHandlers {
  toggleCapture: () => void;
  scoreDraft: (text: string) => ComposeResult;
  autoRewrite: (text: string) => Promise<AutoRewriteView>;
  copyToCopilot: (input: { text: string; adopted: boolean }) => void;
}

/** Sidebar webview that renders the pet, metrics, and coaching panel. */
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
        void vscode.commands.executeCommand('tokentama.scorePrompt');
        break;
      case 'reset':
        void vscode.commands.executeCommand('tokentama.resetEcosystem');
        break;
      case 'toggleCapture':
        this.handlers.toggleCapture();
        break;
      case 'runDemo':
        this.post({ type: 'busy', busy: true });
        void Promise.resolve(
          vscode.commands.executeCommand('tokentama.runDemo'),
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
      case 'composeInput':
        this.post({ type: 'composeResult', result: this.handlers.scoreDraft(msg.text) });
        break;
      case 'autoRewrite':
        void this.handlers
          .autoRewrite(msg.text)
          .then((result) => this.post({ type: 'autoRewriteResult', result }));
        break;
      case 'copyToCopilot':
        this.handlers.copyToCopilot({ text: msg.text, adopted: msg.adopted });
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
