import type { ModelInfo, ScoredEventView } from '../../../src/webview/contract';
import { summarizeContext, toolAdvisory, historyAdvisory } from '../../../src/analysis/contextBreakdown';
import { fmtNum } from '../format';

/**
 * "Where your tokens go" — the real cost driver. Most of a turn's INPUT tokens are
 * fixed overhead (system instructions + tool definitions) plus history/context sent
 * every turn; the user's message is usually a sliver. That overhead is a stable,
 * cacheable prefix — the biggest lever for real savings.
 */
export function ContextPanel({
  lastEvent,
  model,
}: {
  lastEvent?: ScoredEventView;
  model?: ModelInfo;
}) {
  const slices = lastEvent?.contextBreakdown;
  const totalIn = lastEvent?.inputTokens ?? 0;
  const summary = summarizeContext(slices, totalIn);
  if (!summary) return null;
  const advisory = toolAdvisory(slices, totalIn, model?.inputPer1M);
  const history = historyAdvisory(summary);
  const unit = model?.inputPer1M != null ? 'AICs' : '';

  const palette = ['#539bf5', '#d29922', '#3fb950', '#a371f7', '#f85149', '#8b949e'];

  return (
    <section class="context">
      <div class="context-head">
        <span class="section-title">Where your tokens go</span>
        <span class="context-total">{fmtNum(summary.totalTokens)} in</span>
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

      <p class="context-note">
        {summary.overheadPct}% is fixed system + tool overhead ({fmtNum(summary.overheadTokens)}{' '}
        tokens) — a stable prefix that's cacheable. Trim unused tools and avoid re-pasting context
        to keep that cache warm.
      </p>

      {advisory?.recommend && (
        <div class="context-advisory">
          🔧 Tool definitions are {advisory.toolPct}% of every prompt ({fmtNum(advisory.toolTokens)}{' '}
          tokens, re-sent each turn). Disable unused tools / MCP servers to cut this on every turn
          {advisory.costPerDay != null && (
            <> — ≈{advisory.costPerDay.toFixed(1)} {unit}/day saved (est.)</>
          )}
          .
        </div>
      )}

      {history?.recommend && (
        <div class="context-advisory">
          🧹 This chat carries {fmtNum(history.conversationTokens)} tokens of context/history — re-sent
          every turn. Start a fresh chat or summarize to stop paying for it repeatedly.
        </div>
      )}
    </section>
  );
}
