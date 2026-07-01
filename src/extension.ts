import * as vscode from 'vscode';
import * as path from 'node:path';
import type { CoachConfig, CoachProvider } from '@tokentama/llm-adapters';
import { TamaStore } from './state/tamaStore';
import { ScoreService } from './core/scoreService';
import { CopilotWatcher } from './capture/CopilotWatcher';
import { findActiveSession, listCopilotSessions } from './capture/copilotPaths';
import { readSessionEvents } from './capture/copilotReader';
import { StatusBar } from './status/statusBar';
import { DashboardViewProvider } from './webview/DashboardViewProvider';
import { TelemetryService } from './telemetry/telemetryService';
import { hashText } from './telemetry/hash';
import type { TelemetryEvent } from './types/Telemetry';
import { CorpusStore } from './data/corpusStore';
import { RewriteService, type RewriteConfig, type RewriterMode } from './rewriter/rewriteService';
import { summarizeContext, historyAdvisory } from './analysis/contextBreakdown';
import { buildSessionSummary } from './analysis/sessionSummary';
import { computeOutcomes } from './analysis/outcomes';

const SECRET_KEY = 'tokentama.llmApiKey';

export function activate(context: vscode.ExtensionContext): void {
  const store = new TamaStore(context);

  const output = vscode.window.createOutputChannel('Tokentama');
  context.subscriptions.push(output);
  const log = (message: string): void =>
    output.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
  log('Tokentama activated.');

  const workspaceHash = deriveWorkspaceHash(context);
  log(
    workspaceHash
      ? `Capture scoped to this window's workspace storage (${workspaceHash}).`
      : 'No workspace folder open — capture tracks the most recent Copilot session in ANY window. Open a folder for window-scoped capture.',
  );

  const getCoachConfig = async (): Promise<CoachConfig> => {
    const cfg = vscode.workspace.getConfiguration('tokentama.coaching');
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

  const telemetry = new TelemetryService(hashText(vscode.env.machineId));
  context.subscriptions.push(telemetry);

  const corpus = new CorpusStore(
    context.globalStorageUri.fsPath,
    () => vscode.workspace.getConfiguration('tokentama.corpus').get<boolean>('enabled', true),
    () => vscode.workspace.getConfiguration('tokentama.corpus').get<boolean>('storeRawText', true),
  );
  // Close the quality loop: outcomes (retry reduction from adoption) computed lazily
  // from the in-memory corpus and surfaced in state.
  store.setOutcomesProvider(() => computeOutcomes(corpus.all()));

  const scoreService = new ScoreService(store, getCoachConfig, log, telemetry, corpus, () =>
    corpus.all(),
  );

  const getRewriteConfig = async (): Promise<RewriteConfig> => {
    const cfg = vscode.workspace.getConfiguration('tokentama.rewriter');
    const coach = await getCoachConfig();
    const model = cfg.get<string>('model')?.trim();
    return {
      mode: cfg.get<string>('mode', 'auto') as RewriterMode,
      fewShotK: cfg.get<number>('fewShotK', 3),
      coach: model ? { ...coach, deployment: model } : coach,
    };
  };
  const rewriteService = new RewriteService(corpus, getRewriteConfig, lmRewrite);

  const statusBar = new StatusBar();
  context.subscriptions.push(statusBar);

  store.onDidChange((state) => statusBar.update(state));
  statusBar.update(store.getState());

  // Proactive, once-per-bloat nudge: when the chat's history grows large enough to
  // be worth compacting, surface it prominently with a one-click action. Re-arms
  // after history drops (i.e. a fresh chat), so it fires once per bloated session.
  let historyNudged = false;
  store.onDidChange((state) => {
    const summary = summarizeContext(
      state.lastEvent?.contextBreakdown,
      state.lastEvent?.inputTokens ?? 0,
    );
    const advisory = historyAdvisory(summary);
    if (advisory?.recommend && !historyNudged) {
      historyNudged = true;
      const kt = Math.round(advisory.conversationTokens / 1000);
      void vscode.window
        .showWarningMessage(
          `Tokentama: this chat carries ~${kt}k tokens of history — re-sent on every turn. Compact it to a lean summary?`,
          'Start fresh chat (summary copied)',
        )
        .then((choice) => {
          if (choice) void vscode.commands.executeCommand('tokentama.compactSession');
        });
    } else if (!advisory?.recommend) {
      historyNudged = false;
    }
  });

  let watcher: CopilotWatcher | undefined;
  let announcedCapture = false;
  const startWatcher = (): void => {
    if (watcher) return;
    const captureCfg = vscode.workspace.getConfiguration('tokentama.capture');
    const mode = captureCfg.get<string>('mode', 'hybrid');
    if (mode === 'event') {
      log(
        'Capture mode = event: on-disk watcher disabled. Live scoring runs via @tokentama and the compose box; enable hybrid/disk mode to reconcile real tokens.',
      );
      return;
    }
    // Capture scope: 'window' pins to THIS window's sessions; 'all' follows the
    // globally-newest Copilot session across every window (use when Tokentama
    // runs in a different window than the one you code in).
    const scope = captureCfg.get<string>('scope', 'window');
    const hashScope = scope === 'all' ? undefined : workspaceHash;
    if (scope !== 'all' && !workspaceHash) {
      log(
        'Ambient capture paused: this window has no folder open, so there is no window-scoped Copilot session. Open a folder, set "tokentama.capture.scope" to "all", or use @tokentama / the compose box.',
      );
      return;
    }
    watcher = new CopilotWatcher((event, meta) => {
      if (!meta?.preliminary) {
        log(
          `capture: turn ${event.turnIndex} — "${event.promptText
            .slice(0, 60)
            .replace(/\s+/g, ' ')}…"`,
        );
        if (!announcedCapture) {
          announcedCapture = true;
          void vscode.window.showInformationMessage(
            'Tokentama is now auto-grading your Copilot prompts.',
          );
        }
      }
      void scoreService.scoreEvent(event, 'copilot', { preliminary: meta?.preliminary });
    }, hashScope);
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
      `Tokentama passive capture ${next ? 'enabled' : 'disabled'}.`,
    );
  };

  const copyToCopilot = ({ text, adopted }: { text: string; adopted: boolean }): void => {
    void vscode.env.clipboard.writeText(text);
    if (adopted) store.markTipApplied();
    telemetry.suggestionShown({ sessionId: 'compose', source: 'compose', promptText: text });
    telemetry.suggestionAdopted({
      sessionId: 'compose',
      source: 'compose',
      promptText: text,
      adopted,
    });
    void vscode.window.showInformationMessage(
      adopted
        ? 'Leaner rewrite copied — paste it into Copilot Chat.'
        : 'Prompt copied to clipboard.',
    );
  };

  const provider = new DashboardViewProvider(context.extensionUri, store, {
    toggleCapture,
    scoreDraft: (text) => scoreService.scoreDraft(text),
    autoRewrite: async (text) => {
      const model = store.getState().model?.family;
      const r = await rewriteService.rewrite({ promptText: text, model });
      return {
        text,
        rewrittenPrompt: r.rewrittenPrompt,
        estimatedTokenReductionPct: r.estimatedTokenReductionPct,
        clarified: r.clarified,
        source: r.source,
        examplesUsed: r.examplesUsed,
      };
    },
    copyToCopilot,
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tokentama.scorePrompt', () =>
      scoreManualPrompt(scoreService),
    ),
    vscode.commands.registerCommand('tokentama.openDashboard', () =>
      vscode.commands.executeCommand('tokentama.dashboard.focus'),
    ),
    vscode.commands.registerCommand('tokentama.toggleCapture', toggleCapture),
    vscode.commands.registerCommand('tokentama.resetEcosystem', () => {
      store.reset();
      void vscode.window.showInformationMessage('Tokentama ecosystem reset.');
    }),
    vscode.commands.registerCommand('tokentama.rescan', () =>
      rescanCopilot(scoreService, log, workspaceHash),
    ),
    vscode.commands.registerCommand('tokentama.diagnostics', () =>
      showCaptureDiagnostics(workspaceHash, output),
    ),
    vscode.commands.registerCommand('tokentama.runDemo', () => scoreService.runDemo()),
    vscode.commands.registerCommand('tokentama.setLlmApiKey', () => setLlmApiKey(context)),
    vscode.commands.registerCommand('tokentama.exportPilotData', () =>
      exportPilotData(store, telemetry, log),
    ),
    vscode.commands.registerCommand('tokentama.ingestHistory', () =>
      ingestHistory(scoreService, corpus, log, workspaceHash),
    ),
    vscode.commands.registerCommand('tokentama.exportCorpus', () => exportCorpus(corpus, log)),
    vscode.commands.registerCommand('tokentama.compactSession', () =>
      compactSession(workspaceHash, log),
    ),
  );

  registerChatParticipant(context, scoreService, store, log);

  if (store.captureEnabled) startWatcher();
}

export function deactivate(): void {
  /* disposables are cleaned up via context.subscriptions */
}

/**
 * Rewrite completion backed by the VS Code Language Model API — uses the user's
 * OWN Copilot models (no API key). Throws if the LM is unavailable or unauthorized
 * so the rewriter falls back to the offline cleanup.
 */
async function lmRewrite(system: string, user: string): Promise<string> {
  if (!vscode.lm?.selectChatModels) throw new Error('LM API unavailable');
  let models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o-mini' });
  if (models.length === 0) models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  const model = models[0];
  if (!model) throw new Error('No language model available');
  const messages = [vscode.LanguageModelChatMessage.User(`${system}\n\n${user}`)];
  const source = new vscode.CancellationTokenSource();
  try {
    const res = await model.sendRequest(messages, {}, source.token);
    let out = '';
    for await (const part of res.text) out += part;
    return out;
  } finally {
    source.dispose();
  }
}

function registerChatParticipant(
  context: vscode.ExtensionContext,
  scoreService: ScoreService,
  store: TamaStore,
  log: (message: string) => void,
): void {
  if (!vscode.chat?.createChatParticipant) {
    log('Chat participant API unavailable in this VS Code version.');
    return;
  }
  try {
    const participant = vscode.chat.createChatParticipant(
      'tokentama.chat',
      async (request, _chatContext, response) => {
        const text = request.prompt?.trim();
        if (!text) {
          response.markdown('Type a prompt after `@tokentama` and I’ll score its efficiency.');
          return;
        }
        const score = await scoreService.scoreManualText(text);
        const state = store.getState();
        const ev = state.lastEvent;
        response.markdown(
          `**Tokentama score: ${Math.round(score)}/100**  ·  waste ${Math.round(
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
        log(`@tokentama scored a prompt → ${Math.round(score)}/100`);
      },
    );
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
    context.subscriptions.push(participant);
    log('Chat participant @tokentama registered.');
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
  const lines: string[] = ['', '=== Tokentama capture diagnostics ==='];
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
      'Tokentama: no Copilot chat sessions found on disk yet. Send a Copilot prompt first.',
    );
    return;
  }
  const recent = readSessionEvents(active)
    .filter((e) => e.promptText.trim())
    .slice(-3);
  if (recent.length === 0) {
    void vscode.window.showInformationMessage(
      'Tokentama: the latest Copilot session has no prompts to score yet.',
    );
    return;
  }
  for (const event of recent) {
    await scoreService.scoreEvent(event, 'copilot');
  }
  log(`rescan: scored ${recent.length} recent prompt(s) from session ${active.sessionId}.`);
  await vscode.commands.executeCommand('tokentama.dashboard.focus');
  void vscode.window.showInformationMessage(
    `Tokentama scored your ${recent.length} most recent Copilot prompt(s).`,
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
  await vscode.commands.executeCommand('tokentama.dashboard.focus');
  void vscode.window.showInformationMessage(`Tokentama score: ${Math.round(score)} / 100`);
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
    void vscode.window.showInformationMessage('Tokentama coaching API key cleared.');
  } else {
    await context.secrets.store(SECRET_KEY, key);
    void vscode.window.showInformationMessage('Tokentama coaching API key saved.');
  }
}

/**
 * Export locally-buffered pilot telemetry as JSON + CSV to a folder the user
 * picks. This is the explicit, consented handoff path — the only way pilot data
 * leaves the buffer. Includes before/after session deltas from metrics.
 */
async function exportPilotData(
  store: TamaStore,
  telemetry: TelemetryService,
  log: (message: string) => void,
): Promise<void> {
  const events = telemetry.snapshot();
  if (events.length === 0) {
    void vscode.window.showInformationMessage(
      'Tokentama: no pilot data collected yet. Enable "tokentama.telemetry.enabled" and score some prompts first.',
    );
    return;
  }
  const metrics = store.getState().metrics;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const summary = {
    exportedAt: new Date().toISOString(),
    eventCount: events.length,
    metrics,
    outcomes: store.getState().outcomes,
  };
  const json = JSON.stringify({ summary, events }, null, 2);

  const cols = [
    'timestamp',
    'name',
    'sessionId',
    'source',
    'model',
    'reasoningEffort',
    'dominantCategory',
    'overallScore',
    'wasteScore',
    'inputTokens',
    'outputTokens',
    'estimatedCostUsd',
    'retryCount',
    'promptHash',
  ];
  const cell = (e: TelemetryEvent, key: string): string => {
    const raw =
      key === 'timestamp'
        ? e.timestamp
        : key === 'name'
          ? e.name
          : key === 'sessionId'
            ? e.sessionId
            : (e.properties?.[key] ?? e.measurements?.[key] ?? '');
    const s = String(raw).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const csv = [cols.join(',')]
    .concat(events.map((e) => cols.map((c) => cell(e, c)).join(',')))
    .join('\n');

  const folder = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Export Tokentama pilot data here',
  });
  if (!folder || folder.length === 0) return;
  const dir = folder[0];
  const enc = new TextEncoder();
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(dir, `tokentama-pilot-${stamp}.json`),
    enc.encode(json),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(dir, `tokentama-pilot-${stamp}.csv`),
    enc.encode(csv),
  );
  log(`exportPilotData: wrote ${events.length} events to ${dir.fsPath}`);
  void vscode.window.showInformationMessage(
    `Tokentama pilot data exported (${events.length} events) to ${dir.fsPath}.`,
  );
}

/**
 * Backfill the local training corpus from the user's ENTIRE Copilot history on
 * disk (every session, every window). Scores each turn offline and records the
 * original prompt + its lean rewrite — the substrate for training an auto-rewriter.
 */
async function ingestHistory(
  scoreService: ScoreService,
  corpus: CorpusStore,
  log: (message: string) => void,
  _onlyHash?: string,
): Promise<void> {
  const before = corpus.count();
  let scanned = 0;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Tokentama: ingesting Copilot history…' },
    async () => {
      let sessions: ReturnType<typeof listCopilotSessions> = [];
      try {
        sessions = listCopilotSessions(undefined, undefined);
      } catch {
        sessions = [];
      }
      scoreService.beginIngest();
      for (const session of sessions) {
        let events: ReturnType<typeof readSessionEvents> = [];
        try {
          events = readSessionEvents(session);
        } catch {
          continue;
        }
        for (const ev of events) {
          if (!ev.promptText.trim()) continue;
          scoreService.ingestToCorpus(ev);
          scanned++;
        }
      }
    },
  );
  const added = corpus.count() - before;
  log(`ingestHistory: scanned ${scanned} turns, added ${added} new corpus record(s) (total ${corpus.count()}).`);
  void vscode.window.showInformationMessage(
    `Tokentama ingested ${added} new prompt(s) from your Copilot history (corpus: ${corpus.count()}).`,
  );
}

/**
 * Export the local corpus as JSONL plus a training-ready file of
 * (original prompt → lean rewrite) pairs, to a folder the user picks.
 */
async function exportCorpus(corpus: CorpusStore, log: (message: string) => void): Promise<void> {
  const records = corpus.all();
  if (records.length === 0) {
    void vscode.window.showInformationMessage(
      'Tokentama: the corpus is empty. Run "Ingest Copilot history" or let capture collect some prompts first.',
    );
    return;
  }
  const pairs = corpus.trainingPairs();
  const folder = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Export Tokentama corpus here',
  });
  if (!folder || folder.length === 0) return;
  const dir = folder[0];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const enc = new TextEncoder();
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(dir, `tokentama-corpus-${stamp}.jsonl`),
    enc.encode(records.map((r) => JSON.stringify(r)).join('\n')),
  );
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(dir, `tokentama-corpus-training-${stamp}.jsonl`),
    enc.encode(pairs.map((p) => JSON.stringify(p)).join('\n')),
  );
  log(`exportCorpus: wrote ${records.length} records and ${pairs.length} training pairs to ${dir.fsPath}`);
  void vscode.window.showInformationMessage(
    `Tokentama corpus exported: ${records.length} records, ${pairs.length} training pairs → ${dir.fsPath}.`,
  );
}

/**
 * One-click session compaction. Builds a compact recap of the current chat's
 * prompts, copies it to the clipboard, and opens a fresh Copilot chat — so the
 * user drops the re-sent-every-turn history and pastes a lean summary instead.
 */
async function compactSession(
  workspaceHash: string | undefined,
  log: (message: string) => void,
): Promise<void> {
  let prompts: string[] = [];
  try {
    const active = findActiveSession(undefined, workspaceHash) ?? findActiveSession();
    if (active) {
      prompts = readSessionEvents(active)
        .filter((e) => e.promptText.trim())
        .map((e) => e.promptText);
    }
  } catch {
    /* fall back to an empty recap */
  }

  const summary = buildSessionSummary(prompts);
  await vscode.env.clipboard.writeText(summary);

  // Open a fresh chat via whichever command this VS Code build exposes.
  let opened = false;
  for (const cmd of ['workbench.action.chat.newChat', 'workbench.action.chat.new']) {
    try {
      await vscode.commands.executeCommand(cmd);
      opened = true;
      break;
    } catch {
      /* try the next id */
    }
  }

  log(`compactSession: recap of ${prompts.length} prompt(s) copied${opened ? ', fresh chat opened' : ''}.`);
  void vscode.window.showInformationMessage(
    opened
      ? 'Fresh chat opened — your session recap is on the clipboard. Paste it to keep context at a fraction of the tokens.'
      : 'Session recap copied to clipboard. Start a new Copilot chat (＋) and paste it to keep context lean.',
  );
}
