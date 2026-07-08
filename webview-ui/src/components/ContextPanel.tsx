import type { ContextSlice } from '../../../src/webview/contract';
import { summarizeContext } from '../../../src/analysis/contextBreakdown';
import { fmtNum } from '../format';

const PALETTE = ['#539bf5', '#d29922', '#3fb950', '#a371f7', '#f85149', '#8b949e'];

/**
 * "Where tokens go" — the real cost driver. Shows the split (system / tools /
 * history / message) for the LATEST prompt, THIS chat, and ALL chats in the
 * workspace, as stacked bars that share one legend. Data comes straight from
 * Copilot's on-disk `promptTokenDetails`.
 */
export function ContextPanel({
  breakdown,
  inputTokens,
  sessionBreakdown,
  sessionInputTokens,
  chatBreakdown,
  chatInputTokens,
  chatSessionCount,
}: {
  breakdown?: ContextSlice[];
  inputTokens?: number;
  sessionBreakdown?: ContextSlice[];
  sessionInputTokens?: number;
  chatBreakdown?: ContextSlice[];
  chatInputTokens?: number;
  chatSessionCount?: number;
}) {
  const latest = summarizeContext(breakdown, inputTokens ?? 0);
  const session = summarizeContext(sessionBreakdown, sessionInputTokens ?? 0);
  const chat = summarizeContext(chatBreakdown, chatInputTokens ?? 0);

  if (!latest) {
    return (
      <section class="card context">
        <div class="context-head">
          <span class="section-title">Where tokens go</span>
        </div>
        <div class="context-bar context-bar-empty" />
        <p class="context-note muted">
          Reading Copilot's token breakdown from disk… the system / tools / history / message split
          appears once the current turn is metered.
        </p>
      </section>
    );
  }

  // Consistent colours by category across both bars (order from the latest turn).
  const order = latest.slices.map((s) => s.label);
  const colorFor = (label: string): string => PALETTE[Math.max(0, order.indexOf(label)) % PALETTE.length];

  // Each bar fills 100% of its OWN segments, so proportions are correct and the
  // bar never comes up short when the reported total includes uncategorised tokens.
  const bar = (slices: ContextSlice[]) => {
    const sum = slices.reduce((a, s) => a + s.tokens, 0) || 1;
    return (
      <div class="context-bar">
        {slices.map((s, i) => {
          const w = (s.tokens / sum) * 100;
          const p = Math.round(w);
          return (
            <div
              key={`${s.label}-${i}`}
              class="context-seg"
              style={{ width: `${w}%`, background: colorFor(s.label) }}
              title={`${s.label}: ${fmtNum(s.tokens)} tokens (${p}%)`}
            >
              {w >= 10 && <span class="context-seg-pct">{p}%</span>}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <section class="card context">
      <div class="context-head">
        <span class="section-title">Where tokens go</span>
      </div>
      <p class="card-scope">Input tokens by scope: this prompt → this chat → all chats in this workspace.</p>

      <div class="context-barrow">
        <span class="context-barlabel">This prompt</span>
        <span class="context-barval">{fmtNum(latest.totalTokens)}</span>
      </div>
      {bar(latest.slices)}

      {session && (
        <>
          <div class="context-barrow">
            <span class="context-barlabel">This chat</span>
            <span class="context-barval">{fmtNum(session.totalTokens)}</span>
          </div>
          {bar(session.slices)}
        </>
      )}

      {chat && (
        <>
          <div class="context-barrow">
            <span class="context-barlabel">
              All chats{chatSessionCount && chatSessionCount > 1 ? ` · ${chatSessionCount}` : ''}
            </span>
            <span class="context-barval">{fmtNum(chat.totalTokens)}</span>
          </div>
          {bar(chat.slices)}
        </>
      )}

      <ul class="context-legend">
        {latest.slices.map((s, i) => (
          <li key={`${s.label}-${i}`}>
            <span class="context-dot" style={{ background: colorFor(s.label) }} />
            <span class="context-label">{s.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
