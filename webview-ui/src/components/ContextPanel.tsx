import type { ModelInfo, ContextSlice } from '../../../src/webview/contract';
import { summarizeContext } from '../../../src/analysis/contextBreakdown';
import { fmtNum } from '../format';

/**
 * "Where your tokens go" — the real cost driver. Most of a turn's INPUT tokens are
 * fixed overhead (system instructions + tool definitions) plus history/context sent
 * every turn; the user's message is usually a sliver. The breakdown comes straight
 * from Copilot's on-disk `promptTokenDetails` for the last real turn.
 */
export function ContextPanel({
  breakdown,
  inputTokens,
  model,
}: {
  breakdown?: ContextSlice[];
  inputTokens?: number;
  model?: ModelInfo;
}) {
  const slices = breakdown;
  const totalIn = inputTokens ?? 0;
  const summary = summarizeContext(slices, totalIn);
  if (!summary) {
    // Always render — a skeleton keeps the dashboard layout fixed before data.
    return (
      <section class="card context">
        <div class="context-head">
          <span class="section-title">Where your tokens go</span>
          <span class="context-total muted">— in</span>
        </div>
        <div class="context-bar context-bar-empty" />
        <p class="context-note muted">
          Reading Copilot's token breakdown from disk… the system / tools / history / message split
          appears once the current turn is metered.
        </p>
      </section>
    );
  }

  const palette = ['#539bf5', '#d29922', '#3fb950', '#a371f7', '#f85149', '#8b949e'];

  return (
    <section class="card context">
      <div class="context-head">
        <span class="section-title">Where tokens go</span>
        <span class="context-sub">latest prompt · {fmtNum(summary.totalTokens)}</span>
      </div>

      <div class="context-bar">
        {summary.slices.map((s, i) => (
          <div
            key={`${s.label}-${i}`}
            class="context-seg"
            style={{
              width: `${(s.tokens / summary.totalTokens) * 100}%`,
              background: palette[i % palette.length],
            }}
            title={`${s.label}: ${fmtNum(s.tokens)} tokens (${s.pct}%)`}
          />
        ))}
      </div>

      <ul class="context-legend">
        {summary.slices.map((s, i) => (
          <li key={`${s.label}-${i}`}>
            <span class="context-dot" style={{ background: palette[i % palette.length] }} />
            <span class="context-label">{s.label}</span>
            <span class="context-val">
              {fmtNum(s.tokens)} · {s.pct}%
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
