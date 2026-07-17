import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { SuccessMetrics, ForecastView } from '../../../src/webview/contract';
import { fmtNum, fmtUsd } from '../format';
import { Tip } from './Tip';

/**
 * Total cost, anchored on MEASURED units: tokens and Copilot credits (AICs) are
 * what Copilot meters; dollars are a derived estimate. A scope selector lets the
 * user read the same three figures for the whole WORKSPACE, just THIS CHAT, or
 * TODAY. Under each figure we show the last turn's delta so movement is visible.
 */
type Scope = 'workspace' | 'chat' | 'today';

const SCOPES: { key: Scope; label: string; tip: string }[] = [
  {
    key: 'workspace',
    label: 'Workspace',
    tip: 'Everything metered across all chats in this workspace.',
  },
  { key: 'chat', label: 'This chat', tip: 'Metered totals for the chat being tracked right now.' },
  {
    key: 'today',
    label: 'Today',
    tip: "Metered totals for turns dated today, across all of this workspace's chats.",
  },
];

export function ImpactTrio({ metrics, forecast }: { metrics: SuccessMetrics; forecast?: ForecastView }) {
  const [scope, setScope] = useState<Scope>('workspace');
  const scopeRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const f = forecast;
  // Whole-workspace totals come straight from disk; fall back to the zero-state
  // metrics only until that disk aggregate lands.
  const hasChat = f?.chatTotalTokens != null;

  const picked =
    scope === 'chat'
      ? {
          tokens: f?.sessionTotalTokens ?? 0,
          tokensPartial: !!f?.sessionTokensPartial,
          credits: f?.sessionCredits ?? 0,
          creditsEstimated: !!f?.sessionCreditsEstimated,
          cost: f?.sessionCostUsd,
          costPartial: !!f?.sessionCostPartial,
        }
      : scope === 'today'
        ? {
            tokens: f?.todayTotalTokens ?? 0,
            tokensPartial: !!f?.todayTokensPartial,
            credits: f?.todayCredits ?? 0,
            creditsEstimated: !!f?.todayCreditsEstimated,
            cost: f?.todayCostUsd,
            costPartial: !!f?.todayCostPartial,
          }
        : {
            tokens: hasChat ? f!.chatTotalTokens! : metrics.totalTokens,
            tokensPartial: hasChat ? !!f!.chatTokensPartial : false,
            credits: hasChat ? f!.chatCredits ?? 0 : metrics.totalCredits,
            creditsEstimated: hasChat ? !!f!.chatCreditsEstimated : metrics.totalCreditsEstimated,
            cost: hasChat ? f!.chatCostUsd : metrics.totalCostUsd,
            costPartial: hasChat ? !!f!.chatCostPartial : false,
          };

  const hasUsdRate =
    picked.cost != null || (scope === 'workspace' && !hasChat && metrics.hasUsdRate);

  // The delta is the most recent turn's contribution — it belongs to the active
  // chat and is dated today, so it's meaningful under every scope.
  const deltaInScope = scope !== 'today' || f?.realLastIsToday;
  const dTokens = deltaInScope ? f?.realLastTotalTokens : undefined;
  const dCredits = deltaInScope ? f?.realLastCredits : undefined;
  const dCost = deltaInScope ? f?.realLastCostUsd : undefined;

  const tiles = [
    {
      key: 'tokens',
      label: picked.tokensPartial ? 'Measured tokens' : 'Tokens',
      value: fmtNum(picked.tokens),
      delta: dTokens != null ? `▲ ${fmtNum(dTokens)}` : '',
      tip: picked.tokensPartial
        ? 'Known metered token minimum for this scope. Copilot omitted input or output metering on at least one completed request; the available direction is still included.'
        : 'Total input + output tokens Copilot metered for this scope. Input includes the whole re-sent context (system, tools, history, your message).',
    },
    {
      key: 'credits',
      label: picked.creditsEstimated ? 'AICs (est.)' : 'AICs',
      value: fmtNum(picked.credits),
      delta: dCredits != null ? `▲ ${fmtNum(dCredits)}` : '',
      tip: 'Copilot AI credits (AICs) — the unit GitHub Copilot actually bills in — metered for this scope. “(est.)” means credits were estimated because Copilot hasn’t written the real figure yet.',
    },
    {
      key: 'cost',
      label: hasUsdRate ? picked.costPartial ? 'Known cost' : 'Cost (est.)' : 'Cost',
      value: hasUsdRate && picked.cost != null ? fmtUsd(picked.cost) : '—',
      delta: hasUsdRate && dCost != null ? `▲ ${fmtUsd(dCost)}` : '',
      tip: picked.costPartial
        ? 'Known cost from available measured token or credit inputs. Missing source meters are excluded and shown in Overview coverage.'
        : 'Estimated $ uses your blended $/million-token rate, not per-model pricing. The default is illustrative and will not match every plan, model, or cache mix. Set tokenlens.impact.usdPerMillionTokens to your effective rate, or set it to 0 to use tokenlens.impact.usdPerCredit.',
    },
  ];

  const scopeIndex = SCOPES.findIndex((s) => s.key === scope);
  const selectScope = (index: number): void => {
    const normalized = (index + SCOPES.length) % SCOPES.length;
    setScope(SCOPES[normalized].key);
    requestAnimationFrame(() => scopeRefs.current[normalized]?.focus());
  };
  const onScopeKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowLeft') selectScope(scopeIndex - 1);
    else if (event.key === 'ArrowRight') selectScope(scopeIndex + 1);
    else if (event.key === 'Home') selectScope(0);
    else if (event.key === 'End') selectScope(SCOPES.length - 1);
    else return;
    event.preventDefault();
  };
  const workspaceLabel =
    f?.aggregateScope === 'allWindows'
      ? 'All windows'
      : f?.aggregateScope === 'emptyWindow'
        ? 'This window'
        : 'Workspace';
  const workspaceTip =
    f?.aggregateScope === 'allWindows'
      ? 'Everything metered across every VS Code window in all-window scope.'
      : f?.aggregateScope === 'emptyWindow'
        ? 'Chats touched since this empty window opened (best-effort isolation).'
        : SCOPES[0].tip;
  const activeTip =
    scope === 'workspace' ? workspaceTip : SCOPES.find((s) => s.key === scope)!.tip;

  return (
    <section class="card impact">
      <header class="impact-head">
        <Tip
          text={`${activeTip} Displayed dollars use your configured blended rate; actual billing varies by model, plan, and cache mix.`}
        >
          <span class="section-title" role="heading" aria-level={2}>Total cost</span>
        </Tip>
        <span class="impact-hint">▲ last metered turn</span>
      </header>
      <div class="impact-scope" role="tablist" aria-label="Cost scope">
        {SCOPES.map((s, index) => (
          <button
            key={s.key}
            ref={(el) => { scopeRefs.current[index] = el; }}
            id={`impact-tab-${s.key}`}
            role="tab"
            aria-selected={scope === s.key}
            aria-controls="impact-panel"
            tabIndex={scope === s.key ? 0 : -1}
            class={`impact-scope-btn${scope === s.key ? ' active' : ''}`}
            title={s.key === 'workspace' ? workspaceTip : s.tip}
            onClick={() => setScope(s.key)}
            onKeyDown={onScopeKeyDown}
          >
            {s.key === 'workspace' ? workspaceLabel : s.label}
          </button>
        ))}
      </div>
      <div
        class="impact-trio"
        id="impact-panel"
        role="tabpanel"
        aria-labelledby={`impact-tab-${scope}`}
      >
        {tiles.map((t) => (
          <div class="impact-tile" key={t.key} title={t.tip}>
            <div class="impact-value">{t.value}</div>
            <div class="impact-label">{t.label}</div>
            {t.delta && <div class="impact-delta">{t.delta}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
