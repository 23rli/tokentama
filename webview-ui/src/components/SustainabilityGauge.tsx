import type { ForecastView } from '../../../src/webview/contract';
import { fmtNum } from '../format';

/** Visuals per sustainability band — light (healthy) → overloaded (blows up). */
const BANDS: Record<
  ForecastView['sustainability'],
  { label: string; caption: string; color: string; emoji: string }
> = {
  light: { label: 'Light', caption: 'Plenty of headroom.', color: '#3fb950', emoji: '🟢' },
  moderate: { label: 'Moderate', caption: 'Building up.', color: '#57ab5a', emoji: '🟢' },
  heavy: { label: 'Heavy', caption: 'Costs climbing.', color: '#d29922', emoji: '🟡' },
  critical: { label: 'Critical', caption: 'Very heavy — consider a fresh chat.', color: '#f0883e', emoji: '🟠' },
  overloaded: { label: 'Overloaded', caption: 'Reset imminent.', color: '#f85149', emoji: '🔴' },
};

/**
 * Context-weight card (the repurposed "health"). Shows how heavy the session has
 * become: a load bar that fills and reddens toward the model's limit, a per-turn
 * bar graph of context growth (with summarization drops visible), and — at the top
 * — an "overloaded" state signalling each new prompt is now unsustainable. Flat,
 * business style. Always renders (skeleton before data) so the layout never shifts.
 */
export function SustainabilityGauge({ forecast }: { forecast?: ForecastView }) {
  const f = forecast;
  const band = f ? BANDS[f.sustainability] : BANDS.light;
  const fill = !f ? 0 : f.loadFraction != null ? Math.min(1, f.loadFraction) : Math.min(1, f.contextTokens / 400_000);
  const blown = f?.sustainability === 'overloaded';
  const series = f?.contextSeries ?? [];
  const peak = series.length ? Math.max(...series) : 1;
  const resets = series.reduce((n, v, i) => (i > 0 && v < series[i - 1] * 0.6 ? n + 1 : n), 0);
  const pct = f?.loadFraction != null ? Math.round(f.loadFraction * 100) : undefined;

  return (
    <section class={`card gauge${blown ? ' gauge-blown' : ''}`}>
      <header class="gauge-head">
        <span class="section-title">Context weight</span>
        <span class="gauge-band" style={{ color: f ? band.color : undefined }}>
          {f ? band.label.toUpperCase() : '—'}
        </span>
      </header>

      <div class="gauge-loadrow">
        <span class={`gauge-load${f ? '' : ' muted'}`}>{f ? fmtNum(f.contextTokens) : '—'}</span>
        <span class="gauge-load-unit">tokens carried, re-sent every turn</span>
      </div>

      <div class="gauge-track">
        <div class="gauge-fill" style={{ width: `${Math.round(fill * 100)}%`, background: f ? band.color : undefined }} />
      </div>
      <div class="gauge-limitline">
        {f?.contextLimit ? (
          <>
            <span>{pct}% of the {fmtNum(f.contextLimit)}-token limit</span>
            <span class="gauge-cap" style={{ color: band.color }}>{band.caption}</span>
          </>
        ) : (
          <span class="muted">Waiting for your first Copilot turn…</span>
        )}
      </div>

      {series.length > 1 && (
        <div class="gauge-graphwrap">
          <span class="gauge-graphtitle">Tokens carried each turn</span>
          <div class="gauge-graph">
            <div class="gauge-yaxis">
              <span>{fmtNum(peak)}</span>
              <span>0</span>
            </div>
            <div class="gauge-spark">
              {series.map((v, i) => (
                <span
                  key={i}
                  class="gauge-bar"
                  title={`Turn ${i + 1}: ${fmtNum(v)} tokens`}
                  style={{
                    height: `${Math.max(3, Math.round((v / peak) * 100))}%`,
                    background: i === series.length - 1 ? band.color : 'var(--vscode-descriptionForeground, #8b949e)',
                    opacity: i === series.length - 1 ? 1 : 0.45,
                  }}
                />
              ))}
            </div>
          </div>
          <div class="gauge-sparkaxis">
            <span>turn 1</span>
            <span>{resets > 0 ? `${resets} reset${resets > 1 ? 's' : ''}` : ''}</span>
            <span>now (turn {series.length})</span>
          </div>
        </div>
      )}
    </section>
  );
}
