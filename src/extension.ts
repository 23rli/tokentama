import * as vscode from 'vscode';
import * as path from 'node:path';
import { TamaStore } from './state/tamaStore';
import { CopilotWatcher } from './capture/CopilotWatcher';
import { findActiveSession, listCopilotSessions } from './capture/copilotPaths';
import { readSessionEvents, readSessionTitle } from './capture/copilotReader';
import { StatusBar } from './status/statusBar';
import { DashboardViewProvider } from './webview/DashboardViewProvider';
import { buildSessionSummary } from './analysis/sessionSummary';
import { ForecastService, type ForecastAccuracy } from './analysis/forecastService';
import type { Forecast } from './analysis/forecast';
import type { ForecastView } from './webview/contract';
import type { PromptEvent, ContextSlice } from '@tokentama/shared-types';
import { estimateCredits } from '@tokentama/scoring-engine';

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

  // Precognition core: rebuild the live forecast from the ACTIVE session on disk
  // (which carries real metered tokens for every completed turn), so it appears
  // immediately and never depends on lagging forward-only capture. Model-agnostic
  // and free (pure arithmetic). Refreshed on each capture event + on a timer.
  // Cache the (expensive) whole-chat aggregate so the 5s timer only re-reads every
  // conversation when something on disk actually changed.
  let chatAggCache:
    | {
        freshest: number;
        count: number;
        breakdown: ContextSlice[];
        input: number;
        output: number;
        credits: number;
        creditsReal: boolean;
      }
    | undefined;
  const refreshForecast = (): void => {
    try {
      // Pin to THIS workspace's active chat so the panel doesn't jump between
      // sessions in other windows. Only fall back to the global-newest session
      // when this window has no folder open (no workspace hash to scope by).
      const session = workspaceHash
        ? findActiveSession(undefined, workspaceHash) ?? undefined
        : findActiveSession();
      if (!session) return;
      const events = readSessionEvents(session);
      if (events.length === 0) return;
      // Metered turns drive the forecast HISTORY; the newest turn overall is the
      // CURRENT prompt the user just wrote — it may not be metered yet (chatSessions
      // lags the transcript), but we still show it and predict from it so the panel
      // tracks what's actually happening instead of the last fully-billed turn.
      const real = events.filter(
        (e) => e.tokens && e.tokens.estimated === false && (e.tokens.inputTokens ?? 0) > 0,
      );
      const current = events[events.length - 1];
      const lastReal = real.length ? real[real.length - 1] : undefined;
      // Every user turn (metered or not) for the History list — so a just-sent turn
      // shows up immediately as "pending" and fills in once Copilot meters it.
      const allTurns = events
        .filter((e) => e.promptText.trim())
        .map((e) => ({
          prompt: e.promptText.replace(/\s+/g, ' ').trim().slice(0, 70),
          tokens: e.tokens?.inputTokens ?? 0,
          metered: !!(e.tokens && e.tokens.estimated === false && (e.tokens.inputTokens ?? 0) > 0),
        }));

      const fs = new ForecastService();
      for (const e of real) {
        fs.recordTurn(
          {
            promptTokens: e.tokens!.inputTokens,
            completionTokens: e.tokens!.outputTokens,
            promptText: e.promptText,
            toolCalls: e.toolCalls?.length,
          },
          { maxInputTokens: e.model?.maxInputTokens, contextMaxTokens: e.model?.contextMaxTokens },
        );
      }
      // Predict the CURRENT turn, conditioned on the prompt actually written.
      const forecast = fs.forecastNext(current.promptText);
      const modelEvent = lastReal ?? current;
      // Session-wide breakdown: sum each category's tokens across every real turn.
      const sessionAgg = new Map<string, { category: string; label: string; tokens: number }>();
      for (const e of real) {
        for (const s of e.tokens?.contextBreakdown ?? []) {
          const cur2 = sessionAgg.get(s.label) ?? { category: s.category, label: s.label, tokens: 0 };
          cur2.tokens += s.tokens;
          sessionAgg.set(s.label, cur2);
        }
      }
      const sessionInputTokens = real.reduce((sum, e) => sum + (e.tokens?.inputTokens ?? 0), 0);
      const sessionBreakdown = [...sessionAgg.values()].map((s) => ({
        category: s.category,
        label: s.label,
        tokens: s.tokens,
        pct: sessionInputTokens > 0 ? Math.round((s.tokens / sessionInputTokens) * 100) : 0,
      }));
      // Whole-chat breakdown: aggregate EVERY conversation in this workspace so the
      // split reflects total spend and doesn't reset when a new chat is started.
      const allSessions = listCopilotSessions(undefined, workspaceHash || undefined);
      const freshest = allSessions.reduce((m, s) => Math.max(m, s.modifiedMs), 0);
      if (
        !chatAggCache ||
        chatAggCache.freshest !== freshest ||
        chatAggCache.count !== allSessions.length
      ) {
        const chatAgg = new Map<string, { category: string; label: string; tokens: number }>();
        let chatInput = 0;
        let chatOutput = 0;
        let chatCredits = 0;
        let chatCreditsReal = false;
        for (const s of allSessions) {
          const evs = s.sessionId === session.sessionId ? events : readSessionEvents(s);
          for (const e of evs) {
            const t = e.tokens;
            if (!t || t.estimated !== false || (t.inputTokens ?? 0) <= 0) continue;
            chatInput += t.inputTokens ?? 0;
            chatOutput += t.outputTokens ?? 0;
            if (t.copilotCredits != null) {
              chatCredits += t.copilotCredits;
              chatCreditsReal = true;
            } else {
              chatCredits += t.estimatedCredits ?? 0;
            }
            for (const sl of t.contextBreakdown ?? []) {
              const cur3 = chatAgg.get(sl.label) ?? { category: sl.category, label: sl.label, tokens: 0 };
              cur3.tokens += sl.tokens;
              chatAgg.set(sl.label, cur3);
            }
          }
        }
        chatAggCache = {
          freshest,
          count: allSessions.length,
          input: chatInput,
          output: chatOutput,
          credits: chatCredits,
          creditsReal: chatCreditsReal,
          breakdown: [...chatAgg.values()].map((s) => ({
            category: s.category,
            label: s.label,
            tokens: s.tokens,
            pct: chatInput > 0 ? Math.round((s.tokens / chatInput) * 100) : 0,
          })),
        };
      }
      // Cost is derived from the (config) blended $/1M-token rate applied to the
      // whole-chat token total — computed fresh each tick so a rate change shows up
      // without waiting for a file to change.
      const usdPerMillionTokens = vscode.workspace
        .getConfiguration('tokentama.impact')
        .get<number>('usdPerMillionTokens', 0.58);
      const chatTotalTokens = chatAggCache.input + chatAggCache.output;
      const chatCostUsd =
        usdPerMillionTokens > 0 ? (chatTotalTokens * usdPerMillionTokens) / 1_000_000 : undefined;
      store.setForecast(
        buildForecastView(forecast, fs.accuracy(), modelEvent, {
          sessionShortId: session.sessionId.slice(0, 8),
          sessionTitle: readSessionTitle(session),
          lastPromptPreview: current.promptText.replace(/\s+/g, ' ').trim().slice(0, 140),
          turnCount: real.length,
          contextSeries: real.map((e) => e.tokens!.inputTokens),
          turnPrompts: real.map((e) => e.promptText.replace(/\s+/g, ' ').trim().slice(0, 70)),
          realLastInputTokens: lastReal?.tokens?.inputTokens,
          realLastCredits: lastReal?.tokens?.copilotCredits ?? lastReal?.tokens?.estimatedCredits,
          contextBreakdown: lastReal?.tokens?.contextBreakdown,
          contextInputTokens: lastReal?.tokens?.inputTokens,
          sessionBreakdown: sessionBreakdown.length ? sessionBreakdown : undefined,
          sessionInputTokens: sessionInputTokens || undefined,
          chatBreakdown: chatAggCache.breakdown.length ? chatAggCache.breakdown : undefined,
          chatInputTokens: chatAggCache.input || undefined,
          chatSessionCount: allSessions.length || undefined,
          chatTotalTokens: chatTotalTokens || undefined,
          chatCredits: chatAggCache.credits || undefined,
          chatCreditsEstimated: !chatAggCache.creditsReal,
          chatCostUsd,
          allTurns,
        }),
      );
    } catch {
      /* best-effort — the panel skeletons remain until data is available */
    }
  };

  const statusBar = new StatusBar();
  context.subscriptions.push(statusBar);

  store.onDidChange((state) => statusBar.update(state));
  statusBar.update(store.getState());

  let watcher: CopilotWatcher | undefined;
  const startWatcher = (): void => {
    if (watcher) return;
    const captureCfg = vscode.workspace.getConfiguration('tokentama.capture');
    const mode = captureCfg.get<string>('mode', 'hybrid');
    if (mode === 'event') {
      log('Capture mode = event: on-disk watcher disabled. Enable hybrid/disk mode to reconcile real tokens.');
      return;
    }
    // Capture scope: 'window' pins to THIS window's sessions; 'all' follows the
    // globally-newest Copilot session across every window.
    const scope = captureCfg.get<string>('scope', 'all');
    const hashScope = scope === 'all' ? undefined : workspaceHash;
    if (scope !== 'all' && !workspaceHash) {
      log('Ambient capture paused: this window has no folder open. Open a folder or set "tokentama.capture.scope" to "all".');
      return;
    }
    watcher = new CopilotWatcher((event, meta) => {
      if (!meta?.preliminary) {
        log(
          `capture: turn ${event.turnIndex} — "${event.promptText
            .slice(0, 60)
            .replace(/\s+/g, ' ')}…"`,
        );
        // Precognition: rebuild the next-turn forecast from the active session's
        // real metered tokens and refresh the panel (skeletons fill in).
        refreshForecast();
      }
    }, hashScope);
    watcher.start();
    context.subscriptions.push(watcher);
    refreshForecast();
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
    log(`passive capture ${next ? 'enabled' : 'disabled'}.`);
  };

  const provider = new DashboardViewProvider(context.extensionUri, store, {
    toggleCapture,
    refresh: refreshForecast,
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tokentama.openDashboard', () =>
      vscode.commands.executeCommand('tokentama.dashboard.focus'),
    ),
    vscode.commands.registerCommand('tokentama.toggleCapture', toggleCapture),
    vscode.commands.registerCommand('tokentama.resetEcosystem', async () => {
      const choice = await vscode.window.showWarningMessage(
        'Reset Token Lens? This clears the tracked history for this workspace. Chats will be re-tracked as new turns arrive.',
        { modal: true },
        'Reset',
      );
      if (choice !== 'Reset') return;
      store.reset();
    }),
    vscode.commands.registerCommand('tokentama.diagnostics', () =>
      showCaptureDiagnostics(workspaceHash, output),
    ),
    vscode.commands.registerCommand('tokentama.captureSelfTest', () =>
      captureSelfTest(workspaceHash, () => watcher, store, output),
    ),
    vscode.commands.registerCommand('tokentama.compactSession', () =>
      compactSession(workspaceHash, log),
    ),
  );

  if (store.captureEnabled) startWatcher();

  // Backstop: refresh the forecast shortly after activation and on a short timer,
  // so the panel stays live on its own — no reload, no click needed. Also refresh
  // the moment this window regains focus (you've usually just finished a turn).
  setTimeout(refreshForecast, 800);
  const forecastTimer = setInterval(refreshForecast, 1500);
  context.subscriptions.push({ dispose: () => clearInterval(forecastTimer) });
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) refreshForecast();
    }),
  );
}

export function deactivate(): void {
  /* disposables are cleaned up via context.subscriptions */
}

/**
 * Assemble the webview forecast view-model: the PREDICTED next turn (+ interval,
 * reset risk, hungriest part), the REAL last turn to compare against, the live
 * self-measured accuracy, and the context-load / sustainability signal that drives
 * the health gauge. Predicted credits price the fresh (growth+draft) portion at
 * the input rate and treat carried context as cached — matching the impact model.
 */
function buildForecastView(f: Forecast, acc: ForecastAccuracy, event: PromptEvent, extras: {
  sessionShortId?: string;
  sessionTitle?: string;
  lastPromptPreview?: string;
  turnCount: number;
  contextSeries: number[];
  turnPrompts?: string[];
  realLastInputTokens?: number;
  realLastCredits?: number;
  contextBreakdown?: ContextSlice[];
  contextInputTokens?: number;
  sessionBreakdown?: ContextSlice[];
  sessionInputTokens?: number;
  chatBreakdown?: ContextSlice[];
  chatInputTokens?: number;
  chatSessionCount?: number;
  chatTotalTokens?: number;
  chatCredits?: number;
  chatCreditsEstimated?: boolean;
  chatCostUsd?: number;
  allTurns?: { prompt: string; tokens: number; metered: boolean }[];
}): ForecastView {
  const contextTokens = f.breakdown.carriedContext;
  // Use the FULL context window (contextMaxTokens, e.g. 1M) as the limit so the
  // percentage matches what GitHub Copilot shows, not the input-only cap.
  const limit = event.model?.contextMaxTokens ?? event.model?.maxInputTokens;
  const loadFraction = limit && limit > 0 ? contextTokens / limit : undefined;
  const expectedOutput = event.tokens?.outputTokens ?? 0;
  const predictedCredits = event.model
    ? estimateCredits(f.predictedInputTokens, expectedOutput, event.model, contextTokens)
    : undefined;

  const sustainability: ForecastView['sustainability'] =
    f.resetRisk === 'high' || (loadFraction ?? 0) >= 0.9
      ? 'overloaded'
      : (loadFraction ?? 0) >= 0.75
        ? 'critical'
        : (loadFraction ?? 0) >= 0.5
          ? 'heavy'
          : (loadFraction ?? 0) >= 0.3
            ? 'moderate'
            : 'light';

  return {
    predictedInputTokens: f.predictedInputTokens,
    intervalLow: f.interval.low,
    intervalHigh: f.interval.high,
    predictedCredits,
    confidence: f.confidence,
    resetRisk: f.resetRisk,
    hungriest: f.hungriest,
    realLastInputTokens: extras.realLastInputTokens,
    realLastCredits: extras.realLastCredits,
    accuracyScore: acc.score,
    accuracySamples: acc.samples,
    intervalCoverage: acc.intervalCoverage,
    contextTokens,
    contextLimit: limit,
    loadFraction,
    sustainability,
    sessionShortId: extras.sessionShortId,
    sessionTitle: extras.sessionTitle,
    lastPromptPreview: extras.lastPromptPreview,
    turnCount: extras.turnCount,
    contextSeries: extras.contextSeries,
    turnPrompts: extras.turnPrompts,
    contextBreakdown: extras.contextBreakdown,
    contextInputTokens: extras.contextInputTokens,
    sessionBreakdown: extras.sessionBreakdown,
    sessionInputTokens: extras.sessionInputTokens,
    chatBreakdown: extras.chatBreakdown,
    chatInputTokens: extras.chatInputTokens,
    chatSessionCount: extras.chatSessionCount,
    chatTotalTokens: extras.chatTotalTokens,
    chatCredits: extras.chatCredits,
    chatCreditsEstimated: extras.chatCreditsEstimated,
    chatCostUsd: extras.chatCostUsd,
    allTurns: extras.allTurns,
  };
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

/** Relative "time ago" for a mtime, for the self-test readout. */
function timeAgo(ms: number): string {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/**
 * Capture self-test: report exactly which chats capture sees, which turns it
 * would emit next, and confirm other windows' chats are excluded — so the numbers
 * can be trusted before relying on them.
 */
function captureSelfTest(
  workspaceHash: string | undefined,
  getWatcher: () => CopilotWatcher | undefined,
  store: TamaStore,
  output: vscode.OutputChannel,
): void {
  const cfg = vscode.workspace.getConfiguration('tokentama.capture');
  const mode = cfg.get<string>('mode', 'hybrid');
  const scope = cfg.get<string>('scope', 'all');
  const hashScope = scope === 'all' ? undefined : workspaceHash;

  const lines: string[] = ['', '=== Tokentama capture self-test ==='];
  lines.push(`config: mode=${mode} · scope=${scope} · capture=${store.captureEnabled ? 'on' : 'off'}`);
  lines.push(
    `this window hash: ${workspaceHash ?? '(none — no folder open)'} → scanning: ${
      hashScope ?? 'ALL windows'
    }`,
  );

  const watcher = getWatcher();
  if (watcher) {
    const d = watcher.diagnostics();
    lines.push(
      `watcher: RUNNING · ${d.seen} turns already captured · ${d.pending} awaiting real tokens · ${d.trackedSessions} chats tracked`,
    );
  } else {
    lines.push(
      `watcher: NOT running (mode=event, capture off, or no window-scoped session). Live scoring uses @tokentama / compose.`,
    );
  }

  let sessions: ReturnType<typeof listCopilotSessions> = [];
  try {
    sessions = listCopilotSessions(undefined, hashScope);
  } catch {
    sessions = [];
  }
  lines.push('', `in-scope chats (newest first): ${sessions.length}`);
  sessions.slice(0, 8).forEach((s, i) => {
    let events: ReturnType<typeof readSessionEvents> = [];
    try {
      events = readSessionEvents(s).filter((e) => e.promptText.trim());
    } catch {
      /* unreadable */
    }
    const real = events.filter((e) => e.tokens && !e.tokens.estimated).length;
    const unseen = watcher
      ? events.filter((e) => !watcher.isSeen(e.sessionId, e.turnIndex)).length
      : events.length;
    const marker = i === 0 ? '▶' : ' ';
    lines.push(
      `${marker} ${s.sessionId.slice(0, 8)} · ${events.length} turns (${real} real) · ${unseen} not-yet-captured · ${timeAgo(
        s.modifiedMs,
      )}`,
    );
    const last = events[events.length - 1];
    if (last) {
      lines.push(`     latest: "${last.promptText.slice(0, 70).replace(/\s+/g, ' ')}"`);
    }
  });

  if (hashScope) {
    let others = 0;
    try {
      others = listCopilotSessions(undefined, undefined).filter(
        (s) => s.workspaceHash !== hashScope,
      ).length;
    } catch {
      /* ignore */
    }
    lines.push('', `isolation: ${others} chat(s) in OTHER windows are excluded (scope=window).`);
  } else {
    lines.push('', 'isolation: scope=all — capturing the newest chat across ALL windows.');
  }
  lines.push(
    'verdict: capture emits ONLY not-yet-captured turns from the in-scope chats above; it does not replay history.',
  );

  for (const line of lines) output.appendLine(line);
  output.show(true);
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
