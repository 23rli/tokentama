import type { ForecastView } from '../../../src/webview/contract';
import { fmtNum } from '../format';

/**
 * Two light boxes instead of one heavy "tracking" card:
 *   NOW  — which session + turn, live accuracy, and the current prompt.
 *   NEXT — the single predicted number + range.
 * The last-turn REAL figure is not repeated here — it lives once, as the delta in
 * Session cost. Both always render (skeleton before data) so layout never shifts.
 */
export function ForecastPanel({ forecast }: { forecast?: ForecastView }) {
  const f = forecast;
  const acc = f && f.accuracySamples > 0 ? `${Math.round(f.accuracyScore)}/100` : '—';

  return (
    <>
      <section class="card now">
        <header class="now-top">
          <span class="now-sid">
            {f?.sessionShortId ? `Session ${f.sessionShortId}` : 'No active session'}
          </span>
          {f && f.turnCount > 0 && <span class="now-turn">turn {f.turnCount}</span>}
          <span class="now-acc" title="Live self-measured accuracy on your real turns">
            {acc} accurate
          </span>
        </header>
        <p class={`now-prompt${f?.lastPromptPreview ? '' : ' muted'}`}>
          {f?.lastPromptPreview ?? 'Waiting for your first Copilot turn…'}
        </p>
      </section>

      <section class="card next">
        <span class="next-kicker">Predicted next turn</span>
        <div class="next-num-row">
          <span class={`next-number${f ? '' : ' muted'}`}>{f ? fmtNum(f.predictedInputTokens) : '—'}</span>
          <span class="next-unit">tokens</span>
          {f?.predictedCredits != null && (
            <span class="next-credits">≈ {Math.round(f.predictedCredits).toLocaleString()} AIC</span>
          )}
        </div>
        <div class="next-range">
          {f ? (
            <>
              range {fmtNum(f.intervalLow)}–{fmtNum(f.intervalHigh)}
              {f.confidence < 0.4 && <span class="next-hedge"> · low confidence</span>}
            </>
          ) : (
            'range —'
          )}
        </div>
        {f?.resetRisk === 'high' && (
          <div class="next-warn">Summarization likely next — a reset may drop cost sharply.</div>
        )}
      </section>
    </>
  );
}
