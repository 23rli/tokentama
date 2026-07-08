import type { SuccessMetrics, ForecastView } from '../../../src/webview/contract';
import { fmtNum, fmtUsd } from '../format';

/**
 * Session cost, anchored on MEASURED units: tokens and Copilot credits (AICs) are
 * what Copilot meters; dollars are a derived estimate. Under each figure we show
 * the LAST TURN'S delta — how much the most recent turn added — so movement is
 * visible instead of a "wasted" figure. Three clearly-separated numbers.
 */
export function ImpactTrio({ metrics, forecast }: { metrics: SuccessMetrics; forecast?: ForecastView }) {
  const perCreditUsd = metrics.totalCredits > 0 ? metrics.totalCostUsd / metrics.totalCredits : 0;
  const dTokens = forecast?.realLastInputTokens;
  const dCredits = forecast?.realLastCredits;
  const dCost = dCredits != null ? dCredits * perCreditUsd : undefined;

  const tiles = [
    {
      key: 'tokens',
      label: 'Tokens',
      value: fmtNum(metrics.totalTokens),
      delta: dTokens != null ? `▲ ${fmtNum(dTokens)}` : '',
    },
    {
      key: 'credits',
      label: metrics.totalCreditsEstimated ? 'AICs (est.)' : 'AICs',
      value: fmtNum(metrics.totalCredits),
      delta: dCredits != null ? `▲ ${fmtNum(dCredits)}` : '',
    },
    {
      key: 'cost',
      label: metrics.hasUsdRate ? 'Cost (est.)' : 'Cost',
      value: metrics.hasUsdRate ? fmtUsd(metrics.totalCostUsd) : '—',
      delta: metrics.hasUsdRate && dCost != null ? `▲ ${fmtUsd(dCost)}` : '',
    },
  ];

  return (
    <section class="card impact">
      <header class="impact-head">
        <span class="section-title">Session cost</span>
        <span class="impact-hint">▲ last turn</span>
      </header>
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
