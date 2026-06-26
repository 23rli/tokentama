import type { ScoredEventView, WasteComponent } from '../../../src/webview/contract';

/** The four prompt-quality factors that drive the EcoScore. */
const FACTORS: { label: string; categories: string[] }[] = [
  { label: 'Duplicate', categories: ['redundantContext', 'retryLoop'] },
  { label: 'Vague', categories: ['vagueness'] },
  { label: 'Verbose', categories: ['verbosityMismatch'] },
  { label: 'Ignored coaching', categories: ['ignoredCoaching'] },
];

function severityFor(breakdown: WasteComponent[], categories: string[]): number {
  let worst = 0;
  for (const c of breakdown) {
    if (categories.includes(c.category) && c.severity > worst) worst = c.severity;
  }
  return worst;
}

/**
 * A glanceable read of the four quality factors for the last prompt. Empty bars
 * mean a clean prompt; longer/redder bars mean more avoidable waste.
 */
export function QualityBars({ lastEvent }: { lastEvent?: ScoredEventView }) {
  const breakdown = lastEvent?.wasteBreakdown ?? [];

  return (
    <section class="quality">
      <div class="quality-head">
        <span class="quality-title">Prompt quality</span>
        <span class="quality-hint">{lastEvent ? 'last prompt' : 'no prompt yet'}</span>
      </div>
      <div class="quality-bars">
        {FACTORS.map((f) => {
          const sev = lastEvent ? severityFor(breakdown, f.categories) : 0;
          const tone = sev >= 0.5 ? 'bad' : sev >= 0.25 ? 'warn' : 'good';
          return (
            <div class="quality-row" key={f.label}>
              <span class="quality-label">{f.label}</span>
              <div class="quality-bar">
                <div
                  class={`quality-fill quality-${tone}`}
                  style={{ width: `${Math.round(sev * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {lastEvent && lastEvent.reasons.length > 0 && (
        <p class="quality-why">{lastEvent.reasons[0]}</p>
      )}
    </section>
  );
}
