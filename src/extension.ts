import * as vscode from 'vscode';
import * as path from 'node:path';
import { TokenLensStore } from './state/tokenLensStore';
import { CopilotWatcher } from './capture/CopilotWatcher';
import { getWorkspaceStorageRoot, listCopilotSessions } from './capture/copilotPaths';
import {
  normalizeCaptureScope,
  scopeHash,
  selectSessionsInScope,
} from './capture/sessionScope';
import { readSessionEvents, readSessionTitle } from './capture/copilotReader';
import { StatusBar } from './status/statusBar';
import { DashboardViewProvider } from './webview/DashboardViewProvider';
import { ForecastService } from './analysis/forecastService';
import { buildForecastView } from './analysis/forecastView';
import {
  configuredCostUsd,
  creditAmount,
  creditAmountForMeteredUsage,
} from './analysis/cost';
import { meteredTokenParts, summarizeMeteredUsage } from './analysis/meteredUsage';
import {
  sanitizeBusinessToolRates,
  summarizeBusinessActivity,
} from './analysis/businessActivity';
import { createBusinessToolRegistry } from './analysis/businessToolGroups';
import { LocalUsageLedger } from './ledger/LocalUsageLedger';
import { buildPersonalLedgerOverview } from './ledger/query';
import { buildLedgerCsvExport, buildLedgerJsonExport } from './ledger/export';
import {
  materializedRecordsAfterClearWatermark,
  observationsAfterClearWatermark,
  visibleLedgerDiagnostics,
} from './ledger/retention';
import { CopilotUsageAdapter } from './sources/copilot/CopilotUsageAdapter';
import type { ForecastView } from './webview/contract';
import type {
  PromptEvent,
  ContextSlice,
  BusinessActivitySummary,
  UsageSourceHealth,
} from '@tokentama/shared-types';

const FORECAST_HISTORY_LIMIT = 200;
const LEDGER_CLEARED_BEFORE_KEY = 'tokenlens.ledger.clearedBefore';

export function activate(context: vscode.ExtensionContext): void {
  const store = new TokenLensStore();
  context.subscriptions.push(store);
  // When this window's extension started — used to scope EMPTY windows (which have
  // no workspace hash) to chats touched since the window opened, so they don't
  // inherit the previous window's chat.
  const activatedAt = Date.now();

  // Optional per-workspace pin: the session id the user locked onto so Token Lens
  // keeps tracking it instead of following the newest chat (resolves same-folder /
  // two-empty-window ties). Stored in workspaceState so it survives a reload.
  const PINNED_KEY = 'tokenlens.pinnedSessionId';
  const getPinnedSessionId = (): string | undefined =>
    context.workspaceState.get<string>(PINNED_KEY);

  const output = vscode.window.createOutputChannel('Token Lens');
  context.subscriptions.push(output);
  const log = (message: string): void =>
    output.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
  log('Token Lens activated.');

  const workspaceHash = deriveWorkspaceHash(context);
  const workspaceStorageRoot = deriveWorkspaceStorageRoot(context);
  const usageLedger = new LocalUsageLedger(
    path.join(context.globalStorageUri.fsPath, 'usage-ledger-v1'),
  );
  const copilotAdapter = new CopilotUsageAdapter(workspaceStorageRoot);
  let sourceHealth: UsageSourceHealth[] = [{
    adapterId: copilotAdapter.id,
    applicationName: copilotAdapter.applicationName,
    status: 'empty',
    sessionCount: 0,
    detail: 'Local ledger is initializing.',
    capabilities: copilotAdapter.capabilities,
  }];
  let ledgerSourceSignature = '';
  let ledgerSyncInFlight: Promise<void> | undefined;
  let lastLedgerError: string | undefined;
  log(
    workspaceHash
      ? `Capture scoped to this window's workspace storage (${workspaceHash}).`
      : 'No workspace folder open — capture starts empty and follows chats touched after this window opened. Open a folder for stronger isolation.',
  );

  const ledgerSessionsInScope = () => {
    const scope = normalizeCaptureScope(
      vscode.workspace.getConfiguration('tokenlens.capture').get('scope', 'window'),
    );
    return selectSessionsInScope(
      listCopilotSessions(workspaceStorageRoot, scopeHash(scope, workspaceHash)),
      { scope, workspaceHash, activatedAt, pinnedSessionId: getPinnedSessionId() },
    ).sessions;
  };

  const syncPersonalLedger = (forceScan = false, scanAllLocal = false): Promise<void> => {
    if (ledgerSyncInFlight) return ledgerSyncInFlight;
    ledgerSyncInFlight = (async () => {
      await usageLedger.initialize();
      if (store.captureEnabled) {
        const sessions = scanAllLocal
          ? listCopilotSessions(workspaceStorageRoot)
          : ledgerSessionsInScope();
        const signature = `${scanAllLocal ? 'all-local' : 'live-scope'}|${sessions
          .map((session) => `${session.workspaceHash}/${session.sessionId}:${session.modifiedMs}`)
          .join('|')}`;
        if (forceScan || signature !== ledgerSourceSignature) {
          const scan = await copilotAdapter.scan(sessions);
          const clearedBefore = context.globalState.get<string>(LEDGER_CLEARED_BEFORE_KEY);
          const eligible = observationsAfterClearWatermark(scan.observations, clearedBefore);
          const appended = await usageLedger.append(eligible);
          sourceHealth = [scan.health];
          ledgerSourceSignature = signature;
          if (forceScan || scanAllLocal) {
            log(`ledger: scanned ${sessions.length} local session file${sessions.length === 1 ? '' : 's'} and projected ${scan.observations.length} usage record${scan.observations.length === 1 ? '' : 's'}.`);
          }
          if (appended.appended > 0) {
            log(`ledger: appended ${appended.appended} content-free observation${appended.appended === 1 ? '' : 's'}.`);
          }
        }
      } else {
        sourceHealth = sourceHealth.map((source) => ({
          ...source,
          detail: 'Source capture is paused; persisted local ledger remains available.',
        }));
      }
      const snapshot = await usageLedger.materialize();
      const clearedBefore = context.globalState.get<string>(LEDGER_CLEARED_BEFORE_KEY);
      const visibleRecords = materializedRecordsAfterClearWatermark(snapshot.records, clearedBefore);
      const visibleDiagnostics = visibleLedgerDiagnostics(snapshot.diagnostics, visibleRecords);
      const impact = vscode.workspace.getConfiguration('tokenlens.impact');
      store.setPersonalLedger(buildPersonalLedgerOverview(
        visibleRecords,
        visibleDiagnostics,
        sourceHealth,
        {
          usdPerMillionTokens: impact.get<number>('usdPerMillionTokens', 0.58),
          usdPerCredit: impact.get<number>('usdPerCredit', 0),
        },
      ));
      lastLedgerError = undefined;
    })()
      .catch((error) => {
        const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
        if (detail !== lastLedgerError) {
          log(`Ledger sync failed: ${detail}`);
          lastLedgerError = detail;
        }
      })
      .finally(() => {
        ledgerSyncInFlight = undefined;
      });
    return ledgerSyncInFlight;
  };

  // Rebuild the live forecast from the active chat on disk
  // (which carries real metered tokens for every completed turn), so it appears
  // immediately and never depends on lagging forward-only capture. Model-agnostic
  // and free (pure arithmetic). Refreshed on each capture event + on a timer.
  // Cache the (expensive) whole-chat aggregate so the 5s timer only re-reads every
  // conversation when something on disk actually changed.
  let chatAggCache:
    | {
        signature: string;
        day: string;
        businessConfigSignature: string;
        breakdown: ContextSlice[];
        input: number;
        output: number;
        tokensPartial: boolean;
        credits: number;
        creditsEstimated: boolean;
        todayInput: number;
        todayOutput: number;
        todayTokensPartial: boolean;
        todayCredits: number;
        todayCreditsEstimated: boolean;
        businessWorkspace: BusinessActivitySummary;
        businessToday: BusinessActivitySummary;
      }
    | undefined;
  let lastRefreshError: string | undefined;
  const refreshForecast = (): void => {
    // The capture toggle is a privacy boundary, not just a watcher preference.
    // When off, no timer/focus/view refresh may read Copilot's files.
    if (!store.captureEnabled) return;
    try {
      const scope = normalizeCaptureScope(
        vscode.workspace.getConfiguration('tokenlens.capture').get('scope', 'window'),
      );
      // Sessions in scope for THIS window (folder / scope=all / empty-window since
      // open), with the active chat chosen pin-aware — see sessionScope.ts.
      const { sessions: allSessions, active: session } = selectSessionsInScope(
        listCopilotSessions(workspaceStorageRoot, scopeHash(scope, workspaceHash)),
        { scope, workspaceHash, activatedAt, pinnedSessionId: getPinnedSessionId() },
      );
      if (!session) {
        chatAggCache = undefined;
        store.clearForecast();
        return;
      }
      const events = readSessionEvents(session);
      if (events.length === 0) {
        store.clearForecast();
        return;
      }
      // Metered turns drive the forecast HISTORY; the newest turn overall is the
      // CURRENT prompt the user just wrote — it may not be metered yet (chatSessions
      // lags the transcript), but we still show it and predict from it so the panel
      // tracks what's actually happening instead of the last fully-billed turn.
      const real = events.filter(
        (e) => {
          const parts = meteredTokenParts(e.tokens);
          return parts.fullyMetered && parts.input > 0;
        },
      );
      const current = events[events.length - 1];
      const lastReal = real.length ? real[real.length - 1] : undefined;
      const currentIsPending = current.meteringStatus === 'pending';
      // Every user turn (metered or not) for the History list — so a just-sent turn
      // shows up immediately as "pending" and fills in once Copilot meters it.
      const allTurns = events
        .filter((e) => e.promptText.trim())
        .map((e) => {
          const parts = meteredTokenParts(e.tokens);
          return {
            prompt: e.promptText.replace(/\s+/g, ' ').trim().slice(0, 70),
            tokens: parts.inputMetered ? parts.input : parts.output,
            metered: parts.fullyMetered,
            partial: parts.partial,
            status: e.meteringStatus ?? (parts.fullyMetered ? 'metered' : parts.inputMetered ? 'input-only' : parts.outputMetered ? 'output-only' : 'unavailable'),
          };
        });

      const fs = new ForecastService();
      // Replaying accuracy is intentionally quadratic in the calibration window;
      // cap it so pathological multi-thousand-turn chats cannot stall the host.
      for (const e of real.slice(-FORECAST_HISTORY_LIMIT)) {
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
      // While a turn is in flight, estimate that known prompt honestly. Once it
      // is metered, switch back to a true next-turn structural forecast.
      const forecastTarget: ForecastView['forecastTarget'] = currentIsPending
        ? 'pending'
        : 'next';
      const forecast = fs.forecastNext(forecastTarget === 'pending' ? current.promptText : '');
      const modelEvent = lastReal ?? current;
      // Session-wide breakdown: sum each category's tokens across every real turn.
      const sessionAgg = new Map<string, { category: string; label: string; tokens: number }>();
      for (const e of events) {
        if (!meteredTokenParts(e.tokens).inputMetered) continue;
        for (const s of e.tokens?.contextBreakdown ?? []) {
          const cur2 = sessionAgg.get(s.label) ?? { category: s.category, label: s.label, tokens: 0 };
          cur2.tokens += s.tokens;
          sessionAgg.set(s.label, cur2);
        }
      }
      const sessionUsage = summarizeMeteredUsage(events);
      const sessionInputTokens = sessionUsage.input;
      const sessionOutputTokens = sessionUsage.output;
      // This-chat credit total (real metered when available, else estimated).
      let sessionCredits = 0;
      let sessionCreditsEstimated = sessionUsage.measuredTurns === 0;
      for (const e of events) {
        if (!meteredTokenParts(e.tokens).anyMetered) continue;
        const credit = creditAmountForMeteredUsage(e.tokens);
        sessionCredits += credit.value;
        sessionCreditsEstimated ||= credit.estimated;
      }
      const sessionBreakdown = [...sessionAgg.values()].map((s) => ({
        category: s.category,
        label: s.label,
        tokens: s.tokens,
        pct: sessionInputTokens > 0 ? Math.round((s.tokens / sessionInputTokens) * 100) : 0,
      }));
      const usdPerMillionTokens = vscode.workspace
        .getConfiguration('tokenlens.impact')
        .get<number>('usdPerMillionTokens', 0.58);
      const usdPerCredit = vscode.workspace
        .getConfiguration('tokenlens.impact')
        .get<number>('usdPerCredit', 0);
      const businessConfig = vscode.workspace.getConfiguration('tokenlens.businessTools');
      const businessRates = sanitizeBusinessToolRates(businessConfig.get('rates', {}));
      const businessRegistry = createBusinessToolRegistry(
        businessConfig.get('enabled', false),
        businessConfig.get('enabledGroups', []),
        businessConfig.get('customGroups', {}),
      );
      const businessConfigSignature = JSON.stringify({
        rates: businessRates,
        registry: businessRegistry.signature,
      });
      const businessCostOptions = { usdPerMillionTokens, usdPerCredit };
      // Whole-chat breakdown: aggregate every conversation in scope (this window)
      // so the split reflects total spend and doesn't reset when a new chat starts.
      const sessionSignature = allSessions
        .map((s) => `${s.workspaceHash}/${s.sessionId}:${s.modifiedMs}`)
        .join('|');
      // 'Today' = turns whose real timestamp falls on the local calendar day; the
      // day key invalidates the cache at midnight so the figure rolls over.
      const todayKey = new Date().toDateString();
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const todayMs = startOfToday.getTime();
      const startOfTomorrow = new Date(startOfToday);
      startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
      const tomorrowMs = startOfTomorrow.getTime();
      if (
        !chatAggCache ||
        chatAggCache.signature !== sessionSignature ||
        chatAggCache.day !== todayKey ||
        chatAggCache.businessConfigSignature !== businessConfigSignature
      ) {
        const chatAgg = new Map<string, { category: string; label: string; tokens: number }>();
        const businessEvents: PromptEvent[] = [];
        const todayBusinessEvents: PromptEvent[] = [];
        let chatInput = 0;
        let chatOutput = 0;
        let chatTokensPartial = false;
        let chatCredits = 0;
        let chatCreditsEstimated = false;
        let todayInput = 0;
        let todayOutput = 0;
        let todayTokensPartial = false;
        let todayCredits = 0;
        let todayCreditsEstimated = false;
        for (const s of allSessions) {
          const evs = s.sessionId === session.sessionId ? events : readSessionEvents(s);
          for (const e of evs) {
            businessEvents.push(e);
            const eventMs = e.timestamp ? Date.parse(e.timestamp) : NaN;
            if (!Number.isNaN(eventMs) && eventMs >= todayMs && eventMs < tomorrowMs) {
              todayBusinessEvents.push(e);
            }
            const t = e.tokens;
            const parts = meteredTokenParts(t);
            if (!parts.anyMetered) continue;
            chatInput += parts.input;
            chatOutput += parts.output;
            chatTokensPartial ||= parts.partial;
            const credit = creditAmountForMeteredUsage(t);
            chatCredits += credit.value;
            chatCreditsEstimated ||= credit.estimated;
            const ts = e.timestamp ? Date.parse(e.timestamp) : NaN;
            if (!Number.isNaN(ts) && ts >= todayMs && ts < tomorrowMs) {
              todayInput += parts.input;
              todayOutput += parts.output;
              todayTokensPartial ||= parts.partial;
              todayCredits += credit.value;
              todayCreditsEstimated ||= credit.estimated;
            }
            for (const sl of parts.inputMetered ? t?.contextBreakdown ?? [] : []) {
              const cur3 = chatAgg.get(sl.label) ?? { category: sl.category, label: sl.label, tokens: 0 };
              cur3.tokens += sl.tokens;
              chatAgg.set(sl.label, cur3);
            }
          }
        }
        chatAggCache = {
          signature: sessionSignature,
          day: todayKey,
          businessConfigSignature,
          input: chatInput,
          output: chatOutput,
          tokensPartial: chatTokensPartial,
          credits: chatCredits,
          creditsEstimated: chatInput === 0 || chatCreditsEstimated,
          todayInput,
          todayOutput,
          todayTokensPartial,
          todayCredits,
          todayCreditsEstimated: todayInput === 0 || todayCreditsEstimated,
          businessWorkspace: summarizeBusinessActivity(
            businessEvents,
            businessRates,
            businessCostOptions,
            businessRegistry,
          ),
          businessToday: summarizeBusinessActivity(
            todayBusinessEvents,
            businessRates,
            businessCostOptions,
            businessRegistry,
          ),
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
      const costOf = (tokens: number, credits: number): number | undefined =>
        configuredCostUsd(tokens, credits, usdPerMillionTokens, usdPerCredit);
      const chatTotalTokens = chatAggCache.input + chatAggCache.output;
      const sessionTotalTokens = sessionInputTokens + sessionOutputTokens;
      const todayTotalTokens = chatAggCache.todayInput + chatAggCache.todayOutput;
      const chatCostUsd = costOf(chatTotalTokens, chatAggCache.credits);
      const sessionCostUsd = costOf(sessionTotalTokens, sessionCredits);
      const todayCostUsd = costOf(todayTotalTokens, chatAggCache.todayCredits);
      const costUsesTokens = usdPerMillionTokens > 0;
      const chatCostPartial = costUsesTokens
        ? chatAggCache.tokensPartial
        : chatAggCache.creditsEstimated;
      const sessionCostPartial = costUsesTokens
        ? sessionUsage.partial
        : sessionCreditsEstimated;
      const todayCostPartial = costUsesTokens
        ? chatAggCache.todayTokensPartial
        : chatAggCache.todayCreditsEstimated;
      const lastTurnTotalTokens = lastReal
        ? (lastReal.tokens?.inputTokens ?? 0) + (lastReal.tokens?.outputTokens ?? 0)
        : undefined;
      const lastRealCredit = creditAmount(lastReal?.tokens);
      const lastTurnCredits = lastReal && !lastRealCredit.estimated
        ? lastRealCredit.value
        : undefined;
      const lastTurnCostUsd = lastTurnTotalTokens != null
        ? costOf(lastTurnTotalTokens, lastRealCredit.value)
        : undefined;
      const lastRealTimestamp = lastReal?.timestamp ? Date.parse(lastReal.timestamp) : NaN;
      const lastTurnIsToday =
        !Number.isNaN(lastRealTimestamp) &&
        lastRealTimestamp >= todayMs &&
        lastRealTimestamp < tomorrowMs;
      const sessionBusiness = summarizeBusinessActivity(
        events,
        businessRates,
        businessCostOptions,
        businessRegistry,
      );
      store.setForecast(
        buildForecastView(forecast, fs.accuracy(), modelEvent, {
          forecastTarget,
          sessionShortId: session.sessionId.slice(0, 8),
          sessionTitle: readSessionTitle(session),
          lastPromptPreview: current.promptText.replace(/\s+/g, ' ').trim().slice(0, 140),
          turnCount: real.length,
          contextSeries: real.map((e) => e.tokens!.inputTokens),
          turnPrompts: real.map((e) => e.promptText.replace(/\s+/g, ' ').trim().slice(0, 70)),
          realLastInputTokens: lastReal?.tokens?.inputTokens,
          realLastTotalTokens: lastTurnTotalTokens,
          realLastCredits: lastTurnCredits,
          realLastCostUsd: lastTurnCostUsd,
          realLastIsToday: lastTurnIsToday,
          contextBreakdown: lastReal?.tokens?.contextBreakdown,
          contextInputTokens: lastReal?.tokens?.inputTokens,
          sessionBreakdown: sessionBreakdown.length ? sessionBreakdown : undefined,
          sessionInputTokens: sessionInputTokens || undefined,
          chatBreakdown: chatAggCache.breakdown.length ? chatAggCache.breakdown : undefined,
          chatInputTokens: chatAggCache.input || undefined,
          chatSessionCount: allSessions.length || undefined,
          aggregateScope:
            scope === 'all' ? 'allWindows' : workspaceHash ? 'workspace' : 'emptyWindow',
          chatTotalTokens: chatTotalTokens || undefined,
          chatTokensPartial: chatAggCache.tokensPartial,
          chatCredits: chatAggCache.credits || undefined,
          chatCreditsEstimated: chatAggCache.creditsEstimated,
          chatCostUsd,
          chatCostPartial,
          sessionTotalTokens: sessionTotalTokens || undefined,
          sessionTokensPartial: sessionUsage.partial,
          sessionCredits: sessionCredits || undefined,
          sessionCreditsEstimated,
          sessionCostUsd,
          sessionCostPartial,
          todayTotalTokens: todayTotalTokens || undefined,
          todayTokensPartial: chatAggCache.todayTokensPartial,
          todayCredits: chatAggCache.todayCredits || undefined,
          todayCreditsEstimated: chatAggCache.todayCreditsEstimated,
          todayCostUsd,
          todayCostPartial,
          allTurns,
        }),
        modelEvent.model,
        {
          workspace: chatAggCache.businessWorkspace,
          session: sessionBusiness,
          today: chatAggCache.businessToday,
        },
      );
      lastRefreshError = undefined;
    } catch (error) {
      const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
      if (detail !== lastRefreshError) {
        log(`Forecast refresh failed: ${detail}`);
        lastRefreshError = detail;
      }
    }
  };

  const statusBar = new StatusBar();
  context.subscriptions.push(statusBar);

  context.subscriptions.push(store.onDidChange((state) => statusBar.update(state)));
  statusBar.update(store.getState());

  let watcher: CopilotWatcher | undefined;
  const startWatcher = (): void => {
    if (watcher) return;
    const captureCfg = vscode.workspace.getConfiguration('tokenlens.capture');
    // Scope to this window's workspace when it has one; empty windows watch globally
    // (there's no window to scope to) so they still track the active chat.
    const scope = normalizeCaptureScope(captureCfg.get('scope', 'window'));
    const hashScope = scope !== 'all' && workspaceHash ? workspaceHash : undefined;
    watcher = new CopilotWatcher((event, meta) => {
      // A preliminary event is exactly when the just-sent prompt should appear
      // in Live. Durable ledger sync still waits for final source evidence.
      refreshForecast();
      if (!meta?.preliminary) {
        log(`capture: chat ${event.sessionId.slice(0, 8)}, turn ${event.turnIndex}`);
        void syncPersonalLedger(true);
      }
    }, hashScope, workspaceStorageRoot);
    watcher.start();
    refreshForecast();
    void syncPersonalLedger(true);
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
  context.subscriptions.push({ dispose: stopWatcher });

  const toggleCapture = async (): Promise<void> => {
    const next = !store.captureEnabled;
    try {
      await store.setCaptureEnabled(next);
      if (next) startWatcher();
      else stopWatcher();
      void syncPersonalLedger(next);
      log(`passive capture ${next ? 'enabled' : 'disabled'}.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log(`Could not ${next ? 'enable' : 'disable'} capture: ${detail}`);
      void vscode.window.showErrorMessage(`Token Lens could not update capture: ${detail}`);
    }
  };

  type ManageItem = vscode.QuickPickItem & {
    command: string;
    args?: unknown[];
  };
  const showManageMenu = async (): Promise<void> => {
    const pinned = getPinnedSessionId();
    const items: ManageItem[] = [
      {
        label: store.captureEnabled ? '$(debug-pause) Pause capture' : '$(play) Resume capture',
        description: 'Privacy',
        detail: store.captureEnabled
          ? 'Stop automatic reads; retained metadata remains available.'
          : 'Resume read-only local Copilot capture.',
        command: 'tokenlens.toggleCapture',
      },
      {
        label: '$(export) Export usage ledger',
        description: 'Data',
        detail: 'Save all retained metadata-only records as JSON or CSV.',
        command: 'tokenlens.exportLedger',
      },
      {
        label: '$(sync) Rebuild from available local history',
        description: 'Data',
        detail: 'Clear derived metadata and rescan Copilot files still on this machine.',
        command: 'tokenlens.rebuildLedger',
      },
      {
        label: pinned ? '$(pinned) Unpin current chat' : '$(pin) Pin current chat',
        description: 'Live',
        detail: pinned
          ? `Release chat ${pinned.slice(0, 8)} and follow the newest chat again.`
          : 'Keep Live attached to the current chat when windows share storage.',
        command: pinned ? 'tokenlens.unpinChat' : 'tokenlens.pinChat',
      },
      {
        label: '$(settings-gear) Open Token Lens settings',
        description: 'Configuration',
        command: 'workbench.action.openSettings',
        args: ['@ext:tokentama.tokentama'],
      },
      {
        label: '$(pulse) Check capture health',
        description: 'Support',
        detail: 'Show scope, active-chat, watcher, and ledger details.',
        command: 'tokenlens.diagnostics',
      },
      {
        label: '$(beaker) Test current chat capture',
        description: 'Support',
        detail: 'Verify parsing and report metering coverage for the active chat.',
        command: 'tokenlens.captureSelfTest',
      },
      {
        label: '$(database) Inspect ledger health',
        description: 'Support',
        detail: 'Show records, observations, storage, conflicts, and malformed data.',
        command: 'tokenlens.ledgerDiagnostics',
      },
      {
        label: '$(trash) Clear local usage ledger',
        description: 'Data',
        detail: 'Delete Token Lens metadata only; Copilot source files are untouched.',
        command: 'tokenlens.clearLedger',
      },
    ];
    const selected = await vscode.window.showQuickPick(items, {
      title: 'Token Lens',
      placeHolder: 'Choose a data, live, configuration, or support action',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (selected) {
      await vscode.commands.executeCommand(selected.command, ...(selected.args ?? []));
    }
  };

  const provider = new DashboardViewProvider(context.extensionUri, store, {
    toggleCapture,
    manage: showManageMenu,
    exportLedger: async () => {
      await vscode.commands.executeCommand('tokenlens.exportLedger');
    },
    refresh: refreshForecast,
    openBusinessToolSettings: () => {
      void vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'tokenlens.businessTools',
      );
    },
    setBusinessToolTracking: async (enabled) => {
      await vscode.workspace
        .getConfiguration('tokenlens.businessTools')
        .update('enabled', enabled, configurationTarget());
    },
    setBusinessToolGroup: async (groupId, enabled) => {
      const config = vscode.workspace.getConfiguration('tokenlens.businessTools');
      const current = config.get<string[]>('enabledGroups', []);
      const next = enabled
        ? [...new Set([...current, groupId])]
        : current.filter((id) => id !== groupId);
      await config.update('enabledGroups', next, configurationTarget());
    },
  });
  context.subscriptions.push(provider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tokenlens.openDashboard', () =>
      vscode.commands.executeCommand('tokenlens.dashboard.focus'),
    ),
    vscode.commands.registerCommand('tokenlens.manage', showManageMenu),
    vscode.commands.registerCommand('tokenlens.toggleCapture', toggleCapture),
    vscode.commands.registerCommand('tokenlens.togglePinChat', () =>
      vscode.commands.executeCommand(
        getPinnedSessionId() ? 'tokenlens.unpinChat' : 'tokenlens.pinChat',
      ),
    ),
    // Separate pin/unpin and support command IDs remain registered for existing
    // keybindings and automation, but are consolidated in the public UI.
    vscode.commands.registerCommand('tokenlens.pinChat', async () => {
      try {
        const scope = normalizeCaptureScope(
          vscode.workspace.getConfiguration('tokenlens.capture').get('scope', 'window'),
        );
        const { active } = selectSessionsInScope(
          listCopilotSessions(workspaceStorageRoot, scopeHash(scope, workspaceHash)),
          { scope, workspaceHash, activatedAt, pinnedSessionId: undefined },
        );
        if (!active) {
          void vscode.window.showInformationMessage(
            'Token Lens: no active chat to pin yet — open Copilot Chat here and send a prompt first.',
          );
          return;
        }
        await context.workspaceState.update(PINNED_KEY, active.sessionId);
        log(`pinned chat ${active.sessionId.slice(0, 8)}`);
        void vscode.window.showInformationMessage(
          `Token Lens pinned to this chat (${active.sessionId.slice(0, 8)}). It will keep tracking this chat until you unpin.`,
        );
        refreshForecast();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        log(`Could not pin chat: ${detail}`);
        void vscode.window.showErrorMessage(`Token Lens could not pin this chat: ${detail}`);
      }
    }),
    vscode.commands.registerCommand('tokenlens.unpinChat', async () => {
      await context.workspaceState.update(PINNED_KEY, undefined);
      log('unpinned chat');
      void vscode.window.showInformationMessage(
        'Token Lens unpinned — following the newest chat again.',
      );
      refreshForecast();
    }),
    vscode.commands.registerCommand('tokenlens.diagnostics', () => {
      try {
        const scope = normalizeCaptureScope(
          vscode.workspace.getConfiguration('tokenlens.capture').get('scope', 'window'),
        );
        const { sessions, active } = selectSessionsInScope(
          listCopilotSessions(workspaceStorageRoot, scopeHash(scope, workspaceHash)),
          { scope, workspaceHash, activatedAt, pinnedSessionId: getPinnedSessionId() },
        );
        const live = watcher?.diagnostics();
        log('--- capture diagnostics ---');
        log(`enabled=${store.captureEnabled} scope=${scope} workspace=${workspaceHash ?? 'empty'}`);
        log(`sessions=${sessions.length} active=${active?.sessionId.slice(0, 8) ?? 'none'} pinned=${getPinnedSessionId()?.slice(0, 8) ?? 'none'}`);
        log(`watcher=${watcher ? 'running' : 'stopped'} seen=${live?.seen ?? 0} pending=${live?.pending ?? 0} tracked=${live?.trackedSessions ?? 0}`);
        const ledgerState = store.getState().personalLedger;
        log(`ledger=${ledgerState?.diagnostics.recordCount ?? 0} records / ${ledgerState?.diagnostics.observationCount ?? 0} observations / ${ledgerState?.diagnostics.storageBytes ?? 0} bytes / malformed=${ledgerState?.diagnostics.malformedLines ?? 0} / conflicts=${ledgerState?.diagnostics.conflictingRecords ?? 0}`);
        output.show(true);
        void vscode.window.showInformationMessage(
          `Token Lens diagnostics: ${sessions.length} chat${sessions.length === 1 ? '' : 's'} visible; active ${active?.sessionId.slice(0, 8) ?? 'none'}. Details are in Output → Token Lens.`,
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        log(`Capture diagnostics failed: ${detail}`);
        void vscode.window.showErrorMessage(`Token Lens diagnostics failed: ${detail}`);
      }
    }),
    vscode.commands.registerCommand('tokenlens.captureSelfTest', () => {
      try {
        const scope = normalizeCaptureScope(
          vscode.workspace.getConfiguration('tokenlens.capture').get('scope', 'window'),
        );
        const { active } = selectSessionsInScope(
          listCopilotSessions(workspaceStorageRoot, scopeHash(scope, workspaceHash)),
          { scope, workspaceHash, activatedAt, pinnedSessionId: getPinnedSessionId() },
        );
        if (!active) {
          void vscode.window.showWarningMessage(
            'Token Lens self-test: no in-scope Copilot chat found. Send a Copilot prompt in this window, then retry.',
          );
          return;
        }
        const events = readSessionEvents(active);
        const metered = events.filter(
          (event) => meteredTokenParts(event.tokens).fullyMetered,
        ).length;
        const partial = events.filter(
          (event) => meteredTokenParts(event.tokens).partial,
        ).length;
        const result = `${events.length} turn${events.length === 1 ? '' : 's'}, ${metered} fully metered, ${partial} partial`;
        log(`capture self-test: PASS — chat ${active.sessionId.slice(0, 8)}, ${result}.`);
        void vscode.window.showInformationMessage(`Token Lens self-test passed: ${result}.`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        log(`Capture self-test failed: ${detail}`);
        void vscode.window.showErrorMessage(`Token Lens self-test failed: ${detail}`);
      }
    }),
    vscode.commands.registerCommand('tokenlens.exportLedger', async () => {
      try {
        await syncPersonalLedger(false);
        const format = await vscode.window.showQuickPick(
          [
            { label: 'JSON', description: 'Versioned content-free ledger records' },
            { label: 'CSV', description: 'Flat metadata rows for personal analysis' },
          ],
          { placeHolder: 'Choose a metadata-only export format' },
        );
        if (!format) return;
        const extension = format.label.toLowerCase();
        const target = await vscode.window.showSaveDialog({
          saveLabel: 'Export local ledger',
          filters: format.label === 'JSON' ? { JSON: ['json'] } : { CSV: ['csv'] },
          defaultUri: vscode.Uri.file(
            path.join(
              process.env.USERPROFILE ?? process.env.HOME ?? context.globalStorageUri.fsPath,
              `token-lens-usage-${new Date().toISOString().slice(0, 10)}.${extension}`,
            ),
          ),
        });
        if (!target) return;
        const snapshot = await usageLedger.materialize();
        const clearedBefore = context.globalState.get<string>(LEDGER_CLEARED_BEFORE_KEY);
        const visibleRecords = materializedRecordsAfterClearWatermark(snapshot.records, clearedBefore);
        const visibleDiagnostics = visibleLedgerDiagnostics(snapshot.diagnostics, visibleRecords);
        const impact = vscode.workspace.getConfiguration('tokenlens.impact');
        const overview = buildPersonalLedgerOverview(
          visibleRecords,
          visibleDiagnostics,
          sourceHealth,
          {
            usdPerMillionTokens: impact.get<number>('usdPerMillionTokens', 0.58),
            usdPerCredit: impact.get<number>('usdPerCredit', 0),
          },
        );
        const content = format.label === 'JSON'
          ? `${JSON.stringify(buildLedgerJsonExport(visibleRecords, overview), null, 2)}\n`
          : `${buildLedgerCsvExport(visibleRecords)}\r\n`;
        await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
        void vscode.window.showInformationMessage(
          `Token Lens exported ${visibleRecords.length} metadata-only record${visibleRecords.length === 1 ? '' : 's'}.`,
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        log(`Ledger export failed: ${detail}`);
        void vscode.window.showErrorMessage(`Token Lens could not export the local ledger: ${detail}`);
      }
    }),
    vscode.commands.registerCommand('tokenlens.clearLedger', async () => {
      const confirmed = await vscode.window.showWarningMessage(
        'Clear Token Lens local usage metadata? Copilot source files are not changed.',
        { modal: true },
        'Clear local ledger',
      );
      if (confirmed !== 'Clear local ledger') return;
      await ledgerSyncInFlight;
      await usageLedger.clear();
      await context.globalState.update(LEDGER_CLEARED_BEFORE_KEY, new Date().toISOString());
      ledgerSourceSignature = '';
      await syncPersonalLedger(false);
      void vscode.window.showInformationMessage('Token Lens local usage ledger cleared.');
    }),
    vscode.commands.registerCommand('tokenlens.rebuildLedger', async () => {
      if (!store.captureEnabled) {
        void vscode.window.showWarningMessage(
          'Enable passive capture before rebuilding so Token Lens may read local source files.',
        );
        return;
      }
      const confirmed = await vscode.window.showWarningMessage(
        'Rebuild Token Lens local usage metadata from all currently available local Copilot workspaces? Source files are read-only. Chats Copilot no longer retains on this machine cannot be restored.',
        { modal: true },
        'Rebuild local ledger',
      );
      if (confirmed !== 'Rebuild local ledger') return;
      await ledgerSyncInFlight;
      await usageLedger.clear();
      await context.globalState.update(LEDGER_CLEARED_BEFORE_KEY, undefined);
      ledgerSourceSignature = '';
      await syncPersonalLedger(true, true);
      if (lastLedgerError) {
        void vscode.window.showErrorMessage(
          `Token Lens could not complete the local ledger rebuild: ${lastLedgerError.split('\n')[0]}`,
        );
        return;
      }
      const rebuilt = store.getState().personalLedger;
      const sessionCount = sourceHealth[0]?.sessionCount ?? 0;
      const recordCount = rebuilt?.diagnostics.recordCount ?? 0;
      const message = `Token Lens rebuilt ${recordCount} usage record${recordCount === 1 ? '' : 's'} from ${sessionCount} local Copilot session file${sessionCount === 1 ? '' : 's'}.`;
      if (sourceHealth[0]?.status === 'error') {
        void vscode.window.showWarningMessage(`${message} Some session files could not be read; see Token Lens diagnostics.`);
      } else {
        void vscode.window.showInformationMessage(message);
      }
    }),
    vscode.commands.registerCommand('tokenlens.ledgerDiagnostics', async () => {
      await syncPersonalLedger(false);
      const ledger = store.getState().personalLedger;
      log('--- local ledger diagnostics ---');
      log(`root=${usageLedger.storageRoot}`);
      log(`records=${ledger?.diagnostics.recordCount ?? 0} observations=${ledger?.diagnostics.observationCount ?? 0} files=${ledger?.diagnostics.fileCount ?? 0} bytes=${ledger?.diagnostics.storageBytes ?? 0}`);
      log(`duplicates=${ledger?.diagnostics.duplicateObservations ?? 0} malformed=${ledger?.diagnostics.malformedLines ?? 0} conflicts=${ledger?.diagnostics.conflictingRecords ?? 0} retention=${ledger?.diagnostics.retention ?? 'until-cleared'}`);
      for (const file of ledger?.diagnostics.malformedFiles ?? []) {
        log(`malformedPartition=${file}`);
      }
      for (const source of ledger?.sources ?? []) {
        log(`source=${source.adapterId} status=${source.status} sessions=${source.sessionCount} perToolTokens=${source.capabilities.perToolTokens}`);
      }
      output.show(true);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      const captureEnabledChanged = event.affectsConfiguration(
        'tokenlens.passiveCapture.enabled',
      );
      const scopeChanged = event.affectsConfiguration('tokenlens.capture.scope');
      if (captureEnabledChanged) {
        const enabled = vscode.workspace
          .getConfiguration('tokenlens.passiveCapture')
          .get<boolean>('enabled', true);
        store.syncCaptureEnabled(enabled);
        if (enabled) startWatcher();
        else stopWatcher();
      }
      if (scopeChanged) {
        chatAggCache = undefined;
        ledgerSourceSignature = '';
        stopWatcher();
        if (store.captureEnabled) startWatcher();
      }
      if (
        captureEnabledChanged ||
        scopeChanged ||
        event.affectsConfiguration('tokenlens.impact') ||
        event.affectsConfiguration('tokenlens.businessTools')
      ) {
        if (event.affectsConfiguration('tokenlens.businessTools')) {
          store.clearBusinessActivity();
        }
        if (
          event.affectsConfiguration('tokenlens.impact') ||
          event.affectsConfiguration('tokenlens.businessTools')
        ) {
          chatAggCache = undefined;
        }
        refreshForecast();
        void syncPersonalLedger(scopeChanged);
        store.ping();
      }
    }),
  );

  if (store.captureEnabled) startWatcher();
  else void syncPersonalLedger(false);

  // Backstop: refresh the forecast shortly after activation and on a short timer,
  // so the panel stays live on its own — no reload, no click needed. Also refresh
  // the moment this window regains focus (you've usually just finished a turn).
  const warmupTimer = setTimeout(refreshForecast, 800);
  const forecastTimer = setInterval(refreshForecast, 1500);
  const ledgerTimer = setInterval(() => void syncPersonalLedger(false), 5000);
  context.subscriptions.push({
    dispose: () => {
      clearTimeout(warmupTimer);
      clearInterval(forecastTimer);
      clearInterval(ledgerTimer);
    },
  });
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) {
        refreshForecast();
        void syncPersonalLedger(false);
      }
    }),
  );
}

export function deactivate(): void {
  /* disposables are cleaned up via context.subscriptions */
}

function deriveWorkspaceHash(context: vscode.ExtensionContext): string | undefined {
  // context.storageUri = .../User/workspaceStorage/<hash>/<extensionId>
  const storage = context.storageUri?.fsPath;
  if (!storage) return undefined;
  return path.basename(path.dirname(storage));
}

function deriveWorkspaceStorageRoot(context: vscode.ExtensionContext): string {
  // globalStorageUri = .../User/globalStorage/<publisher>.<extension>; deriving
  // from VS Code itself handles Stable/Insiders, portable data dirs, macOS/Linux,
  // and remote extension hosts more reliably than hard-coding APPDATA.
  const globalStorage = context.globalStorageUri?.fsPath;
  return globalStorage
    ? path.join(path.dirname(path.dirname(globalStorage)), 'workspaceStorage')
    : getWorkspaceStorageRoot();
}

function configurationTarget(): vscode.ConfigurationTarget {
  return vscode.workspace.workspaceFile || (vscode.workspace.workspaceFolders?.length ?? 0) > 0
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}
