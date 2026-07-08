import type { ForecastView } from '../../../src/webview/contract';
import { fmtNum } from '../format';

/**
 * A readable, scrollable per-turn history — the answer to "what was turn 20?" and
 * to graphs getting cramped once a session has many turns. Newest first; each row
 * shows the turn number, its prompt excerpt, the tokens it carried, and the change
 * from the previous turn (a drop = a summarization reset).
 */
export function HistoryView({ forecast }: { forecast?: ForecastView }) {
  // Prefer the full turn list (includes just-sent "pending" turns); fall back to
  // the metered-only series for older payloads.
  const all = forecast?.allTurns;
  const series = forecast?.contextSeries ?? [];
  const prompts = forecast?.turnPrompts ?? [];

  const rows = all
    ? all.map((t, i) => ({
        turn: i + 1,
        prompt: t.prompt || '—',
        tokens: t.tokens,
        metered: t.metered,
        delta: i > 0 ? t.tokens - all[i - 1].tokens : t.tokens,
      }))
    : series.map((v, i) => ({
        turn: i + 1,
        prompt: prompts[i] || '—',
        tokens: v,
        metered: true,
        delta: i > 0 ? v - series[i - 1] : v,
      }));

  if (rows.length === 0) {
    return <div class="card history-empty muted">No turns captured yet — start a Copilot chat.</div>;
  }

  return (
    <section class="card history">
      <div class="history-head">
        <span class="section-title">Turn history</span>
        <span class="history-count">{rows.length} turns</span>
      </div>
      <div class="history-list">
        {rows
          .slice()
          .reverse()
          .map((r) => (
            <div class="history-row" key={r.turn}>
              <span class="history-turn">{r.turn}</span>
              <span class="history-prompt" title={r.prompt}>{r.prompt}</span>
              {r.metered ? (
                <>
                  <span class="history-tokens">{fmtNum(r.tokens)}</span>
                  <span class={`history-delta${r.delta < 0 ? ' down' : ''}`}>
                    {r.delta < 0 ? `▼ ${fmtNum(-r.delta)}` : `▲ ${fmtNum(r.delta)}`}
                  </span>
                </>
              ) : (
                <>
                  <span class="history-tokens muted">…</span>
                  <span class="history-delta muted">pending</span>
                </>
              )}
            </div>
          ))}
      </div>
    </section>
  );
}
