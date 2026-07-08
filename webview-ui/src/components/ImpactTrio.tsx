import type { SuccessMetrics, ForecastView } from '../../../src/webview/contract';
import { fmtNum, fmtUsd } from '../format';

/**
 * Total cost, anchored on MEASURED units: tokens and Copilot credits (AICs) are
 * what Copilot meters; dollars are a derived estimate. Under each figure we show
 * the LAST TURN'S delta — how much the most recent turn added — so movement is
 * visible instead of a "wasted" figure. Three clearly-separated numbers.
 */
export function ImpactTrio({ metrics, forecast }: { metrics: SuccessMetrics; forecast?: ForecastView }) {
  // Prefer the whole-chat totals read straight from disk (every chat in this
  // workspace) so the figure is stable across reloads and matches the "All chats"
  // bar. Fall back to live-captured metrics only until the disk aggregate loads.
  const hasChat = forecast?.chatTotalTokens != null;
  const totalTokens = hasChat ? forecast!.chatTotalTokens! : metrics.totalTokens;
  const totalCredits = hasChat ? forecast!.chatCredits ?? 0 : metrics.totalCredits;
  const creditsEstimated = hasChat ? !!forecast!.chatCreditsEstimated : metrics.totalCreditsEstimated;
  const totalCostUsd = hasChat ? forecast!.chatCostUsd : metrics.totalCostUsd;
  const hasUsdRate = hasChat ? forecast!.chatCostUsd != null : metrics.hasUsdRate;

  const perCreditUsd = totalCredits > 0 && totalCostUsd != null ? totalCostUsd / totalCredits : 0;
  const dTokens = forecast?.realLastInputTokens;
  const dCredits = forecast?.realLastCredits;
  const dCost = dCredits != null && perCreditUsd > 0 ? dCredits * perCreditUsd : undefined;

  const tiles = [
    {
      key: 'tokens',
      label: 'Tokens',
      value: fmtNum(totalTokens),
      delta: dTokens != null ? `▲ ${fmtNum(dTokens)}` : '',
    },
    {
      key: 'credits',
      label: creditsEstimated ? 'AICs (est.)' : 'AICs',
      value: fmtNum(totalCredits),
      delta: dCredits != null ? `▲ ${fmtNum(dCredits)}` : '',
    },
    {
      key: 'cost',
      label: hasUsdRate ? 'Cost (est.)' : 'Cost',
      value: hasUsdRate && totalCostUsd != null ? fmtUsd(totalCostUsd) : '—',
      delta: hasUsdRate && dCost != null ? `▲ ${fmtUsd(dCost)}` : '',
    },
  ];

  return (
    <section class="card impact">
      <header class="impact-head">
        <span class="section-title">Total cost</span>
        <span class="impact-hint">▲ last turn</span>
      </header>
      <p class="card-scope">Everything metered across all chats in this workspace.</p>
      <div class="impact-trio">
        {tiles.map((t) => (
          <div class="impact-tile" key={t.key}>
            <div class="impact-value">{t.value}</div>
            <div class="impact-label">{t.label}</div>
            {t.delta && <div class="impact-delta">{t.delta}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
