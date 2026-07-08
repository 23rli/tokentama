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
  const prompts = f?.turnPrompts ?? [];
  const peak = series.length ? Math.max(...series) : 1;
  const resets = series.reduce((n, v, i) => (i > 0 && v < series[i - 1] * 0.6 ? n + 1 : n), 0);
  const pct = f?.loadFraction != null ? Math.round(f.loadFraction * 100) : undefined;

  // Downsample the BARS so a long chat doesn't turn into unreadable slivers; the
  // trend line still uses the full series, so the true shape is preserved.
  const MAX_BARS = 44;
  const bars: { v: number; turn: number; prompt?: string }[] =
    series.length <= MAX_BARS
      ? series.map((v, i) => ({ v, turn: i + 1, prompt: prompts[i] }))
      : Array.from({ length: MAX_BARS }, (_, b) => {
          const idx = Math.min(series.length - 1, Math.floor(((b + 1) * series.length) / MAX_BARS) - 1);
          return { v: series[idx], turn: idx + 1, prompt: prompts[idx] };
        });
  const sampled = series.length > MAX_BARS;

  return (
    <section class={`card gauge${blown ? ' gauge-blown' : ''}`}>
      <header class="gauge-head">
        <span class="section-title">Context weight</span>
        <span class="gauge-band" style={{ color: f ? band.color : undefined }}>
          {f ? band.label : '—'}
        </span>
      </header>
      <p class="card-scope">Context loaded in this chat right now — resets when Copilot summarizes.</p>

      <div class="gauge-loadrow">
        <span class={`gauge-load${f ? '' : ' muted'}`}>{f ? fmtNum(f.contextTokens) : '—'}</span>
        <span class="gauge-load-unit">tokens carried</span>
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
          <span class="gauge-graphtitle">
            Tokens carried per turn{sampled ? ` · ${series.length} turns, sampled` : ' · hover for prompt'}
          </span>
          <div class="gauge-graph">
            <div class="gauge-yaxis">
              <span>{fmtNum(peak)}</span>
              <span>0</span>
            </div>
            <div class="gauge-plot">
              <div class="gauge-spark">
                {bars.map((d, i) => (
                  <span
                    key={i}
                    class="gauge-bar"
                    title={`Turn ${d.turn}: ${fmtNum(d.v)} tokens${d.prompt ? ` — "${d.prompt}"` : ''}`}
                    style={{
                      height: `${Math.max(2, Math.round((d.v / peak) * 100))}%`,
                      background: i === bars.length - 1 ? band.color : 'var(--vscode-descriptionForeground, #8b949e)',
                      opacity: i === bars.length - 1 ? 1 : 0.4,
                    }}
                  />
                ))}
              </div>
              <svg class="gauge-trend" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <polyline
                  points={series
                    .map((v, i) => `${(i / (series.length - 1)) * 100},${100 - Math.max(2, (v / peak) * 100)}`)
                    .join(' ')}
                  fill="none"
                  stroke={band.color}
                  stroke-width="1.2"
                  vector-effect="non-scaling-stroke"
                />
              </svg>
            </div>
          </div>
          <div class="gauge-sparkaxis">
            <span>turn 1</span>
            <span title="A reset is when Copilot auto-summarizes the chat near the limit, collapsing the carried context.">
              {resets > 0 ? `${resets} reset${resets > 1 ? 's' : ''} ⓘ` : ''}
            </span>
            <span>now (turn {series.length})</span>
          </div>
        </div>
      )}
    </section>
  );
}
