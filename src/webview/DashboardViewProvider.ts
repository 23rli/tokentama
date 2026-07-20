import * as vscode from 'vscode';
import type { TokenLensStore } from '../state/tokenLensStore';
import type { HostMessage, WebviewMessage } from './contract';
import { buildDashboardHtml } from './html';

export interface DashboardHandlers {
  toggleCapture: () => Promise<void>;
  manage: () => Promise<void>;
  exportLedger: () => Promise<void>;
  refresh: () => void;
  openBusinessToolSettings: () => void;
  setBusinessToolTracking: (enabled: boolean) => Promise<void>;
  setBusinessToolGroup: (groupId: string, enabled: boolean) => Promise<void>;
}

/** Sidebar webview that renders the Token Lens cost + forecast dashboard. */
export class DashboardViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'tokenlens.dashboard';

  private view?: vscode.WebviewView;
  private readonly storeSubscription: vscode.Disposable;
  private viewSubscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: TokenLensStore,
    private readonly handlers: DashboardHandlers,
  ) {
    this.storeSubscription = this.store.onDidChange((state) =>
      this.post({ type: 'state', state }),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.disposeViewSubscriptions();
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };
    view.webview.html = buildDashboardHtml(view.webview, this.extensionUri);
    this.viewSubscriptions.push(
      view.webview.onDidReceiveMessage((msg: WebviewMessage) => void this.onMessage(msg)),
    );
    // Re-send the latest state whenever the panel becomes visible again, and pull
    // a FRESH forecast from disk so it never shows a stale snapshot after being
    // hidden or after turns completed while it wasn't focused.
    this.viewSubscriptions.push(
      view.onDidChangeVisibility(() => {
        if (view.visible) {
          this.handlers.refresh();
          this.post({ type: 'state', state: this.store.getState() });
        }
      }),
      view.onDidDispose(() => {
        if (this.view === view) this.view = undefined;
        this.disposeViewSubscriptions();
      }),
    );
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    switch (msg.type) {
      case 'ready':
        this.handlers.refresh();
        this.post({ type: 'state', state: this.store.getState() });
        break;
      case 'toggleCapture':
        this.post({ type: 'busy', busy: true });
        try {
          await this.handlers.toggleCapture();
        } finally {
          this.post({ type: 'busy', busy: false });
        }
        break;
      case 'manage':
        await this.withBusy(this.handlers.manage);
        break;
      case 'exportLedger':
        await this.withBusy(this.handlers.exportLedger);
        break;
      case 'openBusinessToolSettings':
        this.handlers.openBusinessToolSettings();
        break;
      case 'setBusinessToolTracking':
        await this.withBusy(() => this.handlers.setBusinessToolTracking(msg.enabled));
        break;
      case 'setBusinessToolGroup':
        await this.withBusy(() => this.handlers.setBusinessToolGroup(msg.groupId, msg.enabled));
        break;
    }
  }

  private async withBusy(action: () => Promise<void>): Promise<void> {
    this.post({ type: 'busy', busy: true });
    try {
      await action();
    } finally {
      this.post({ type: 'busy', busy: false });
    }
  }

  private post(message: HostMessage): void {
    void this.view?.webview.postMessage(message);
  }

  dispose(): void {
    this.disposeViewSubscriptions();
    this.storeSubscription.dispose();
  }

  private disposeViewSubscriptions(): void {
    const subscriptions = this.viewSubscriptions;
    this.viewSubscriptions = [];
    for (const subscription of subscriptions) subscription.dispose();
  }
}
