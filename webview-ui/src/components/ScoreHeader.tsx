import type { TamaState } from '../../../src/webview/contract';

function sparkline(points: number[]): string {
  if (points.length < 2) return '';
  const w = 120;
  const h = 28;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  return points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p - min) / span) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

export function ScoreHeader({ state }: { state: TamaState }) {
  const delta = state.lastEvent?.delta ?? 0;
  const trend = state.history.map((h) => h.overallScore);
  const deltaClass = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';

  return (
    <div class="scoreheader">
      <div class="score-main">
        <div class="score-value">{Math.round(state.overallScore)}</div>
        <div class="score-label">
          <span>efficiency</span>
          {state.lastEvent && (
            <span class={`delta delta-${deltaClass}`}>
              {delta > 0 ? '▲' : delta < 0 ? '▼' : '—'} {Math.abs(delta)}
            </span>
          )}
        </div>
      </div>

      <div class="score-side">
        <div class="score-waste">
          <span class="muted">waste</span>
          <strong>{Math.round(state.wasteScore)}</strong>
        </div>
        {trend.length >= 2 && (
          <svg viewBox="0 0 120 28" class="sparkline" preserveAspectRatio="none">
            <path d={sparkline(trend)} fill="none" stroke="currentColor" stroke-width="2" />
          </svg>
        )}
      </div>
    </div>
  );
}
