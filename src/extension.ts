import * as vscode from 'vscode';
import * as path from 'node:path';
import type { CoachConfig, CoachProvider } from '@ecoprompt/llm-adapters';
import { GuardianStore } from './state/guardianStore';
import { ScoreService } from './core/scoreService';
import { CopilotWatcher } from './capture/CopilotWatcher';
import { findActiveSession, listCopilotSessions } from './capture/copilotPaths';
import { readSessionEvents } from './capture/copilotReader';
import { StatusBar } from './status/statusBar';
import { DashboardViewProvider } from './webview/DashboardViewProvider';

const SECRET_KEY = 'ecoprompt.llmApiKey';

export function activate(context: vscode.ExtensionContext): void {
  const store = new GuardianStore(context);

  const output = vscode.window.createOutputChannel('EcoPrompt Guardians');
  context.subscriptions.push(output);
  const log = (message: string): void =>
    output.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
  log('EcoPrompt Guardians activated.');

  const workspaceHash = deriveWorkspaceHash(context);
  log(
    workspaceHash
      ? `Capture scoped to this window's workspace storage (${workspaceHash}).`
      : 'No workspace folder open — capture tracks the most recent Copilot session in ANY window. Open a folder for window-scoped capture.',
  );

  const getCoachConfig = async (): Promise<CoachConfig> => {
    const cfg = vscode.workspace.getConfiguration('ecoprompt.coaching');
    const apiKey = await context.secrets.get(SECRET_KEY);
    return {
      provider: cfg.get<string>('llmProvider', 'none') as CoachProvider,
      endpoint: cfg.get<string>('endpoint') || undefined,
      apiKey: apiKey || undefined,
      deployment: cfg.get<string>('model') || undefined,
      apiVersion: '2024-10-21',
      timeoutMs: 12000,
    };
  };

  const scoreService = new ScoreService(store, getCoachConfig, log);

  const statusBar = new StatusBar();
  context.subscriptions.push(statusBar);
  store.onDidChange((state) => statusBar.update(state));
  statusBar.update(store.getState());

  let watcher: CopilotWatcher | undefined;
  let announcedCapture = false;
  const startWatcher = (): void => {
    if (watcher) return;
    if (!workspaceHash) {
      log(
        'Ambient capture paused: this window has no folder open, so there is no window-scoped Copilot session. Open a folder (the dev host opens the sandbox/ folder via F5), or use @ecoprompt / Score this prompt.',
      );
      return;
    }
    watcher = new CopilotWatcher((event) => {
      log(
        `capture: turn ${event.turnIndex} — "${event.promptText
          .slice(0, 60)
          .replace(/\s+/g, ' ')}…"`,
      );
      if (!announcedCapture) {
        announcedCapture = true;
        void vscode.window.showInformationMessage(
          'EcoPrompt Guardian is now auto-grading your Copilot prompts.',
        );
      }
      void scoreService.scoreEvent(event, 'copilot');
    }, workspaceHash);
    watcher.start();
    context.subscriptions.push(watcher);
    log(
      watcher.isAvailable()
        ? 'Passive capture started — watching Copilot chat sessions on disk.'
        : 'Passive capture started, but no Copilot chat sessions were found yet.',
    );
  };
  const stopWatcher = (): void => {
    watcher?.dispose();
    watcher = undefined;
  };

  const toggleCapture = (): void => {
    const next = !store.captureEnabled;
    void store.setCaptureEnabled(next);
    if (next) startWatcher();
    else stopWatcher();
    void vscode.window.showInformationMessage(
      `EcoPrompt passive capture ${next ? 'enabled' : 'disabled'}.`,
    );
  };

  const provider = new DashboardViewProvider(context.extensionUri, store, { toggleCapture });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ecoprompt.scorePrompt', () =>
      scoreManualPrompt(scoreService),
    ),
    vscode.commands.registerCommand('ecoprompt.openDashboard', () =>
      vscode.commands.executeCommand('ecoprompt.dashboard.focus'),
    ),
    vscode.commands.registerCommand('ecoprompt.toggleCapture', toggleCapture),
    vscode.commands.registerCommand('ecoprompt.resetEcosystem', () => {
      store.reset();
      void vscode.window.showInformationMessage('EcoPrompt ecosystem reset.');
    }),
    vscode.commands.registerCommand('ecoprompt.rescan', () =>
      rescanCopilot(scoreService, log, workspaceHash),
    ),
    vscode.commands.registerCommand('ecoprompt.diagnostics', () =>
      showCaptureDiagnostics(workspaceHash, output),
    ),
    vscode.commands.registerCommand('ecoprompt.runDemo', () => scoreService.runDemo()),
    vscode.commands.registerCommand('ecoprompt.setLlmApiKey', () => setLlmApiKey(context)),
  );

  registerChatParticipant(context, scoreService, store, log);

  if (store.captureEnabled) startWatcher();
}

export function deactivate(): void {
  /* disposables are cleaned up via context.subscriptions */
}

function registerChatParticipant(
  context: vscode.ExtensionContext,
  scoreService: ScoreService,
  store: GuardianStore,
  log: (message: string) => void,
): void {
  if (!vscode.chat?.createChatParticipant) {
    log('Chat participant API unavailable in this VS Code version.');
    return;
  }
  try {
    const participant = vscode.chat.createChatParticipant(
      'ecoprompt.guardian',
      async (request, _chatContext, response) => {
        const text = request.prompt?.trim();
        if (!text) {
          response.markdown('Type a prompt after `@ecoprompt` and I’ll score its efficiency.');
          return;
        }
        const score = await scoreService.scoreManualText(text);
        const state = store.getState();
        const ev = state.lastEvent;
        response.markdown(
          `**EcoPrompt score: ${Math.round(score)}/100**  ·  waste ${Math.round(
            ev?.wasteScore ?? 0,
          )}  ·  ecosystem _${state.world}_\n\n`,
        );
        const top = (ev?.wasteBreakdown ?? [])
          .filter((c) => c.severity > 0.05)
          .sort((a, b) => b.weightedPoints - a.weightedPoints)
          .slice(0, 3);
        if (top.length > 0) {
          response.markdown(
            top.map((c) => `- **${c.category}** — ${c.reason}`).join('\n') + '\n\n',
          );
        }
        if (state.tip) {
          response.markdown(`💡 ${state.tip.message}\n`);
          if (state.tip.rewrittenPrompt) {
            response.markdown(
              `\n**Leaner rewrite:**\n\n\`\`\`\n${state.tip.rewrittenPrompt}\n\`\`\``,
            );
          }
        }
        log(`@ecoprompt scored a prompt → ${Math.round(score)}/100`);
      },
    );
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
    context.subscriptions.push(participant);
    log('Chat participant @ecoprompt registered.');
  } catch (err) {
    log(`Failed to register chat participant: ${String(err)}`);
  }
}

function deriveWorkspaceHash(context: vscode.ExtensionContext): string | undefined {
  // context.storageUri = .../User/workspaceStorage/<hash>/<extensionId>
  const storage = context.storageUri?.fsPath;
  if (!storage) return undefined;
  return path.basename(path.dirname(storage));
}

async function showCaptureDiagnostics(
  workspaceHash: string | undefined,
  output: vscode.OutputChannel,
): Promise<void> {
  const lines: string[] = ['', '=== EcoPrompt capture diagnostics ==='];
  lines.push(
    `scoped workspace hash: ${workspaceHash ?? '(none — empty window, reading globally)'}`,
  );
  try {
    const scoped = listCopilotSessions(undefined, workspaceHash);
    lines.push(`Copilot sessions in scope: ${scoped.length}`);

    const active = findActiveSession(undefined, workspaceHash);
    if (active) {
      const events = readSessionEvents(active).filter((e) => e.promptText.trim());
      const real = events.filter((e) => e.tokens && !e.tokens.estimated);
      lines.push(`active session: ${active.sessionId} (hash ${active.workspaceHash})`);
      lines.push(`  prompts: ${events.length} · with real tokens: ${real.length}`);
      const last = events[events.length - 1];
      if (last) lines.push(`  latest prompt: "${last.promptText.slice(0, 70).replace(/\s+/g, ' ')}"`);
    } else {
      lines.push('active session: none in scope — open Copilot Chat in THIS window and send a prompt.');
    }

    const globalActive = findActiveSession();
    if (globalActive && globalActive.workspaceHash !== active?.workspaceHash) {
      lines.push(
        `note: the globally-newest Copilot session is in a DIFFERENT window (hash ${globalActive.workspaceHash}); scoping is correctly excluding it.`,
      );
    }
  } catch (err) {
    lines.push(`error: ${String(err)}`);
  }

  for (const line of lines) output.appendLine(line);
  output.show(true);
}

async function rescanCopilot(
  scoreService: ScoreService,
  log: (message: string) => void,
  onlyHash?: string,
): Promise<void> {
  const active = findActiveSession(undefined, onlyHash);
  if (!active) {
    log('rescan: no active Copilot session found on disk.');
    void vscode.window.showInformationMessage(
      'EcoPrompt: no Copilot chat sessions found on disk yet. Send a Copilot prompt first.',
    );
    return;
  }
  const recent = readSessionEvents(active)
    .filter((e) => e.promptText.trim())
    .slice(-3);
  if (recent.length === 0) {
    void vscode.window.showInformationMessage(
      'EcoPrompt: the latest Copilot session has no prompts to score yet.',
    );
    return;
  }
  for (const event of recent) {
    await scoreService.scoreEvent(event, 'copilot');
  }
  log(`rescan: scored ${recent.length} recent prompt(s) from session ${active.sessionId}.`);
  await vscode.commands.executeCommand('ecoprompt.dashboard.focus');
  void vscode.window.showInformationMessage(
    `EcoPrompt scored your ${recent.length} most recent Copilot prompt(s).`,
  );
}

async function scoreManualPrompt(scoreService: ScoreService): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const selected =
    editor && !editor.selection.isEmpty
      ? editor.document.getText(editor.selection)
      : undefined;

  const text =
    selected ??
    (await vscode.window.showInputBox({
      prompt: 'Paste a prompt to score for efficiency',
      placeHolder: 'e.g. "Could you please, if it is not too much trouble, kindly help me…"',
      ignoreFocusOut: true,
    }));

  if (!text || !text.trim()) return;

  const score = await scoreService.scoreManualText(text);
  await vscode.commands.executeCommand('ecoprompt.dashboard.focus');
  void vscode.window.showInformationMessage(`EcoPrompt score: ${Math.round(score)} / 100`);
}

async function setLlmApiKey(context: vscode.ExtensionContext): Promise<void> {
  const key = await vscode.window.showInputBox({
    prompt: 'Enter the API key for your coaching LLM provider (stored securely)',
    password: true,
    ignoreFocusOut: true,
  });
  if (key === undefined) return;
  if (key.trim() === '') {
    await context.secrets.delete(SECRET_KEY);
    void vscode.window.showInformationMessage('EcoPrompt coaching API key cleared.');
  } else {
    await context.secrets.store(SECRET_KEY, key);
    void vscode.window.showInformationMessage('EcoPrompt coaching API key saved.');
  }
}
