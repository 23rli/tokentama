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
function equivalent(tokens: number): string {
  if (tokens >= 1_000_000_000) return 'one org, one quarter of AI use';
  if (tokens >= 100_000_000) return 'a mid-size eng team for a month';
  if (tokens >= 1_000_000) return 'one developer for a busy week';
  if (tokens >= 100_000) return 'an afternoon of "chat with my repo"';
  if (tokens >= 1000) return 'a short ChatGPT reply';
  return 'a few keystrokes';
}

/**
 * The headline showcase: what your prompting actually costs — in dollars, carbon,
 * and water — with the share attributable to avoidable waste called out beneath.
 */
export function ImpactTrio({ metrics }: { metrics: SuccessMetrics }) {
  const tiles = [
    {
      key: 'cost',
      icon: '💵',
      label: 'Cost',
      value: fmtUsd(metrics.totalCostUsd),
      waste: fmtUsd(metrics.costUsdWasted),
    },
    {
      key: 'co2',
      icon: '🔥',
      label: 'CO₂e',
      value: fmtGrams(metrics.co2eGramsTotal),
      waste: fmtGrams(metrics.co2eGramsWasted),
    },
    {
      key: 'water',
      icon: '💧',
      label: 'Water',
      value: fmtWater(metrics.waterMlTotal),
      waste: fmtWater(metrics.waterMlWasted),
    },
  ];

  return (
    <section class="impact">
      <div class="impact-trio">
        {tiles.map((t) => (
          <div class="impact-tile" key={t.key}>
            <div class="impact-icon">{t.icon}</div>
            <div class="impact-value">{t.value}</div>
            <div class="impact-label">{t.label}</div>
            <div class="impact-waste">{t.waste} wasted</div>
          </div>
        ))}
      </div>
      <div class="impact-equiv">
        ≈ {equivalent(metrics.totalTokens)} · {fmtNum(metrics.totalTokens)} tokens
      </div>
    </section>
  );
}
