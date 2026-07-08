import * as vscode from 'vscode';
import * as path from 'node:path';
import type { CoachConfig, CoachProvider } from '@tokentama/llm-adapters';
import { TamaStore } from './state/tamaStore';
import { ScoreService } from './core/scoreService';
import { CopilotWatcher } from './capture/CopilotWatcher';
import { findActiveSession, listCopilotSessions } from './capture/copilotPaths';
import { readSessionEvents, readSessionTitle } from './capture/copilotReader';
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
import { buildPortfolio, renderPortfolio } from './analysis/userPortfolio';
import { extractTargets, deriveInsights } from './analysis/corpusInsights';
import { ForecastService, type ForecastAccuracy } from './analysis/forecastService';
import type { Forecast } from './analysis/forecast';
import type { ForecastView } from './webview/contract';
import type { PromptEvent, ContextSlice } from '@tokentama/shared-types';
import { estimateCredits } from '@tokentama/scoring-engine';

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
  store.setOutcomesProvider(() => computeOutcomes(corpus.all(), store.toolSpend()));

  // Compact, continuously-updated profile that the rewriter runs off of (cached
  // by corpus size — recomputed only as the corpus grows).
  let portfolioCache: { size: number; text: string } | undefined;
  const getPortfolio = (): string => {
    const records = corpus.all();
    if (!portfolioCache || portfolioCache.size !== records.length) {
      portfolioCache = { size: records.length, text: renderPortfolio(buildPortfolio(records)) };
    }
    return portfolioCache.text;
  };

  const scoreService = new ScoreService(store, getCoachConfig, log, telemetry, corpus, () =>
    corpus.all(),
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
        }),
      );
    } catch {
      /* best-effort — the panel skeletons remain until data is available */
    }
  };

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
  const rewriteService = new RewriteService(corpus, getRewriteConfig, lmRewrite, getPortfolio, log);

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
    const scope = captureCfg.get<string>('scope', 'all');
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
        // Precognition: rebuild the next-turn forecast from the active session's
        // real metered tokens and refresh the panel (skeletons fill in).
        refreshForecast();
      }
      void scoreService.scoreEvent(event, 'copilot', { preliminary: meta?.preliminary });
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
      const state = store.getState();
      const model = state.model?.family;
      const recentContext = buildRecentContext(state.recentEvents, corpus.all(), text);
      // Only spend a model call when it's likely to HELP (vague / retry-prone /
      // wasteful) and we're under the session rewrite-token budget. Verbose-but-clear
      // prompts get the free offline cleanup instead — protects net savings from
      // speculative spend that would never be adopted.
      const draft = scoreService.scoreDraft(text);
      const beneficial =
        draft.retryRisk === 'high' ||
        draft.retryRisk === 'medium' ||
        !!draft.contextGapHint ||
        draft.overallScore < 70;
      const budget = vscode.workspace
        .getConfiguration('tokentama.rewriter')
        .get<number>('sessionTokenBudget', 20000);
      const withinBudget = budget <= 0 || store.toolSpend() < budget;
      const allowModel = beneficial && withinBudget;
      const r = await rewriteService.rewrite({ promptText: text, model, recentContext, allowModel });
      if (r.llmTokensSpent) store.addToolSpend(r.llmTokensSpent);
      const skipped = allowModel ? '' : ` (model skipped: ${!withinBudget ? 'budget' : 'low benefit'})`;
      log(
        `Rewrite requested — source: ${r.source}${
          r.llmTokensSpent ? `, spent ~${r.llmTokensSpent} tokens` : ''
        }${skipped}.`,
      );
      return {
        text,
        rewrittenPrompt: r.rewrittenPrompt,
        estimatedTokenReductionPct: r.estimatedTokenReductionPct,
        estimatedTokensSaved: r.estimatedTokensSaved,
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
    vscode.commands.registerCommand('tokentama.resetEcosystem', async () => {
      const choice = await vscode.window.showWarningMessage(
        'Reset Tokentama? This clears your pet health, scores, and session history for this workspace. Captured chats will be re-tracked as new prompts arrive.',
        { modal: true },
        'Reset',
      );
      if (choice !== 'Reset') return;
      store.reset();
      void vscode.window.showInformationMessage('Tokentama ecosystem reset.');
    }),
    vscode.commands.registerCommand('tokentama.rescan', () =>
      rescanCopilot(scoreService, log, workspaceHash),
    ),
    vscode.commands.registerCommand('tokentama.diagnostics', () =>
      showCaptureDiagnostics(workspaceHash, output),
    ),
    vscode.commands.registerCommand('tokentama.captureSelfTest', () =>
      captureSelfTest(workspaceHash, () => watcher, store, output),
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

  // Backstop: refresh the forecast shortly after activation and periodically, so
  // the panel populates from any existing session even before a new turn fires.
  setTimeout(refreshForecast, 1200);
  const forecastTimer = setInterval(refreshForecast, 5000);
  context.subscriptions.push({ dispose: () => clearInterval(forecastTimer) });
}

export function deactivate(): void {
  /* disposables are cleaned up via context.subscriptions */
}

/**
 * Build a compact "session context" string for the rewriter from recent scored
 * prompts and the user's frequent corpus targets, so it can resolve vague
 * references ("the component") to files already discussed — without inventing.
 */
function buildRecentContext(
  recentEvents: { promptPreview: string }[] | undefined,
  records: { promptText?: string }[],
  currentText: string,
): string | undefined {
  const already = new Set(extractTargets(currentText));
  const files: string[] = [];
  const addFiles = (text: string): void => {
    for (const t of extractTargets(text)) {
      if (!already.has(t) && !files.includes(t)) files.push(t);
    }
  };
  for (const e of recentEvents ?? []) addFiles(e.promptPreview);
  for (const t of deriveInsights(records as never).topTargets) {
    if (!already.has(t) && !files.includes(t)) files.push(t);
  }
  const recentAsks = (recentEvents ?? [])
    .slice(0, 2)
    .map((e) => e.promptPreview?.trim())
    .filter((p): p is string => !!p);

  const parts: string[] = [];
  if (files.length) parts.push(`Files/targets recently worked on: ${files.slice(0, 5).join(', ')}`);
  if (recentAsks.length) parts.push(`Recent asks: ${recentAsks.map((a) => `“${a}”`).join(' | ')}`);
  return parts.length ? parts.join('\n') : undefined;
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
  };
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
  const timeout = setTimeout(() => source.cancel(), 20000);
  try {
    const res = await model.sendRequest(messages, {}, source.token);
    let out = '';
    for await (const part of res.text) out += part;
    return out;
  } finally {
    clearTimeout(timeout);
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
