import type { ContextSlice } from '../../../src/webview/contract';
import { summarizeContext } from '../../../src/analysis/contextBreakdown';
import { fmtNum } from '../format';

const PALETTE = ['#539bf5', '#d29922', '#3fb950', '#a371f7', '#f85149', '#8b949e'];

/**
 * "Where tokens go" — the real cost driver. Shows the split (system / tools /
 * history / message) both for the LATEST prompt and for the WHOLE session, as two
 * bars that share one legend. Data comes straight from Copilot's on-disk
 * `promptTokenDetails`.
 */
export function ContextPanel({
  breakdown,
  inputTokens,
  sessionBreakdown,
  sessionInputTokens,
}: {
  breakdown?: ContextSlice[];
  inputTokens?: number;
  sessionBreakdown?: ContextSlice[];
  sessionInputTokens?: number;
}) {
  const latest = summarizeContext(breakdown, inputTokens ?? 0);
  const session = summarizeContext(sessionBreakdown, sessionInputTokens ?? 0);

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

  const bar = (slices: ContextSlice[], total: number) => (
    <div class="context-bar">
      {slices.map((s, i) => (
        <div
          key={`${s.label}-${i}`}
          class="context-seg"
          style={{ width: `${(s.tokens / total) * 100}%`, background: colorFor(s.label) }}
          title={`${s.label}: ${fmtNum(s.tokens)} tokens (${s.pct}%)`}
        />
      ))}
    </div>
  );

  return (
    <section class="card context">
      <div class="context-head">
        <span class="section-title">Where tokens go</span>
      </div>

      <div class="context-barrow">
        <span class="context-barlabel">This prompt</span>
        <span class="context-barval">{fmtNum(latest.totalTokens)}</span>
      </div>
      {bar(latest.slices, latest.totalTokens)}

      {session && (
        <>
          <div class="context-barrow">
            <span class="context-barlabel">Whole session</span>
            <span class="context-barval">{fmtNum(session.totalTokens)}</span>
          </div>
          {bar(session.slices, session.totalTokens)}
        </>
      )}

      <ul class="context-legend">
        {latest.slices.map((s, i) => (
          <li key={`${s.label}-${i}`}>
            <span class="context-dot" style={{ background: colorFor(s.label) }} />
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
