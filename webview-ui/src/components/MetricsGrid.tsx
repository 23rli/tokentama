import type { SuccessMetrics } from '../../../src/webview/contract';
import { fmtNum, fmtPctSigned, fmtSigned, fmtUsd } from '../format';

interface Card {
  label: string;
  value: string;
  hint: string;
  tone: 'good' | 'bad' | 'neutral';
}

function toneFor(n: number): Card['tone'] {
  if (n > 0.5) return 'good';
  if (n < -0.5) return 'bad';
  return 'neutral';
}

export function MetricsGrid({ metrics }: { metrics: SuccessMetrics }) {
  const cards: Card[] = [
    {
      label: 'Token reduction',
      value: fmtPctSigned(metrics.tokenReductionPct),
      hint: `${fmtNum(metrics.totalTokens)} tokens total`,
      tone: toneFor(metrics.tokenReductionPct),
    },
    {
      label: 'Waste reduction',
      value: fmtPctSigned(metrics.wasteReductionPct),
      hint: 'lower waste = healthier',
      tone: toneFor(metrics.wasteReductionPct),
    },
    {
      label: 'Prompt quality',
      value: fmtPctSigned(metrics.promptQualityImprovementPct),
      hint: 'clarity & structure',
      tone: toneFor(metrics.promptQualityImprovementPct),
    },
    {
      label: 'Avg score Δ',
      value: fmtSigned(metrics.averageScoreIncrease),
      hint: `${metrics.promptsScored} prompts scored`,
      tone: toneFor(metrics.averageScoreIncrease),
    },
    {
      label: 'Coaching used',
      value: `${Math.round(metrics.coachingEngagement * 100)}%`,
      hint: `${metrics.tipsApplied}/${metrics.tipsShown} tips applied`,
      tone: metrics.coachingEngagement > 0 ? 'good' : 'neutral',
    },
    {
      label: 'CO₂e avoided',
      value: `${metrics.sustainabilityCo2eGrams.toFixed(1)}g`,
      hint:
        metrics.totalCredits > 0
          ? `${metrics.sustainabilityWhSaved.toFixed(1)} Wh · ${Math.round(metrics.totalCredits)} cr`
          : `${metrics.sustainabilityWhSaved.toFixed(1)} Wh · ${fmtUsd(metrics.totalCostUsd)}`,
      tone: metrics.sustainabilityCo2eGrams > 0 ? 'good' : 'neutral',
    },
  ];

  return (
    <section class="metrics">
      <h3 class="section-title">Impact</h3>
      <div class="metrics-grid">
        {cards.map((c) => (
          <div class={`metric-card tone-${c.tone}`} key={c.label}>
            <div class="metric-value">{c.value}</div>
            <div class="metric-label">{c.label}</div>
            <div class="metric-hint">{c.hint}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
