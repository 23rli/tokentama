import type { SuccessMetrics } from '../../../src/webview/contract';
import { fmtNum, fmtUsd } from '../format';

function fmtGrams(g: number): string {
  if (g >= 1000) return `${(g / 1000).toFixed(g >= 10_000 ? 0 : 1)} kg`;
  if (g >= 10) return `${Math.round(g)} g`;
  if (g >= 1) return `${g.toFixed(1)} g`;
  return `${g.toFixed(2)} g`;
}

function fmtWater(ml: number): string {
  if (ml >= 1000) return `${(ml / 1000).toFixed(ml >= 10_000 ? 0 : 1)} L`;
  if (ml >= 10) return `${Math.round(ml)} mL`;
  return `${ml.toFixed(1)} mL`;
}

/** Map a session token total to the per-token table's relatable equivalent. */
/**
 * The headline showcase, anchored on MEASURED units. Tokens and Copilot credits
 * (AICs) are what Copilot actually meters; dollars are a derived estimate shown
 * only when the org configures its AIC→$ rate. Carbon/water are labelled estimates.
 */
export function ImpactTrio({ metrics }: { metrics: SuccessMetrics }) {
  const tiles = [
    {
      key: 'tokens',
      icon: '🔢',
      label: 'Tokens',
      value: fmtNum(metrics.totalTokens),
      waste: '',
    },
    {
      key: 'credits',
      icon: '🎫',
      label: metrics.totalCreditsEstimated ? 'AICs (est.)' : 'AICs',
      value: fmtNum(metrics.totalCredits),
      waste: `${fmtNum(metrics.creditsWasted)} wasted`,
    },
    {
      key: 'cost',
      icon: '💵',
      label: metrics.hasUsdRate ? 'Cost (est.)' : 'Cost',
      value: metrics.hasUsdRate ? fmtUsd(metrics.totalCostUsd) : 'set $/AIC',
      waste: metrics.hasUsdRate ? `${fmtUsd(metrics.costUsdWasted)} wasted` : '',
    },
  ];

  return (
    <section class="card impact">
      <header class="impact-head">
        <span class="section-title">Session cost</span>
        <span class="impact-equiv">{fmtGrams(metrics.co2eGramsTotal)} CO₂e · {fmtWater(metrics.waterMlTotal)} (est.)</span>
      </header>
      <div class="impact-trio">
        {tiles.map((t) => (
          <div class="impact-tile" key={t.key}>
            <div class="impact-value">{t.value}</div>
            <div class="impact-label">{t.label}</div>
            {t.waste && <div class="impact-waste">{t.waste}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
