import type { ScoredEventView } from '../../../src/webview/contract';
import { fmtNum, fmtUsd, fmtWasteCategory } from '../format';

export function WasteBreakdown({ lastEvent }: { lastEvent?: ScoredEventView }) {
  if (!lastEvent) {
    return (
      <section class="waste">
        <h3 class="section-title">Last prompt</h3>
        <p class="empty">Score a prompt to see where tokens are wasted.</p>
      </section>
    );
  }

  const items = lastEvent.wasteBreakdown
    .filter((c) => c.severity > 0.05)
    .sort((a, b) => b.weightedPoints - a.weightedPoints);

  return (
    <section class="waste">
      <h3 class="section-title">Last prompt</h3>

      <div class="waste-meta">
        <span class={`pill source-${lastEvent.source}`}>{lastEvent.source}</span>
        <span class={`pill ${lastEvent.tokensReal ? 'pill-real' : ''}`}>
          {lastEvent.tokensReal ? 'real tokens' : 'estimated'}
        </span>
        <span class="muted">
          {fmtNum(lastEvent.inputTokens)} in · {fmtNum(lastEvent.outputTokens)} out
          {lastEvent.copilotCredits != null
            ? ` · ${lastEvent.copilotCredits.toFixed(1)} cr`
            : ` · ${fmtUsd(lastEvent.estimatedCostUsd)}`}
        </span>
      </div>

      <p class="waste-preview">{lastEvent.promptPreview || '(no prompt text)'}</p>

      {items.length === 0 ? (
        <p class="empty good">No meaningful waste detected — nicely done.</p>
      ) : (
        <ul class="waste-list">
          {items.map((c) => (
            <li key={c.category}>
              <div class="waste-row">
                <span class="waste-name">{fmtWasteCategory(c.category)}</span>
                <span class="waste-points">+{Math.round(c.weightedPoints)}</span>
              </div>
              <div class="bar">
                <div class="bar-fill" style={{ width: `${Math.min(100, c.severity * 100)}%` }} />
              </div>
              <p class="waste-reason">{c.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
