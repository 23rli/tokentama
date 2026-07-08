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

  return (
    <>
      <section class="card now">
        <span class="section-title">Now</span>
        <div class="now-meta">
          <span class="now-sid">
            {f?.sessionShortId ? `Session ${f.sessionShortId}` : 'No active session'}
          </span>
          {f && f.turnCount > 0 && <span class="now-turn">· turn {f.turnCount}</span>}
        </div>
        <span class="now-label">Latest prompt</span>
        <p class={`now-prompt${f?.lastPromptPreview ? '' : ' muted'}`}>
          {f?.lastPromptPreview ?? 'Waiting for your first Copilot turn…'}
        </p>
      </section>

      <section class="card next">
        <span class="section-title">Predicted next turn</span>
        <div class="next-num-row">
          <span class={`next-number${f ? '' : ' muted'}`}>{f ? fmtNum(f.predictedInputTokens) : '—'}</span>
          <span class="next-unit">tokens in</span>
        </div>
        <div class="next-detail">
          {f ? (
            <>
              {f.predictedCredits != null && <>≈ {Math.round(f.predictedCredits).toLocaleString()} credits · </>}
              likely {fmtNum(f.intervalLow)}–{fmtNum(f.intervalHigh)}
              {f.confidence < 0.4 && <span class="next-hedge"> · low confidence</span>}
            </>
          ) : (
            'likely —'
          )}
        </div>
        {f && f.accuracySamples > 0 && (
          <div class="next-acc" title={`Median error on ${f.accuracySamples} of your past turns`}>
            Forecast accuracy <b>{Math.round(f.accuracyScore)}/100</b> — how close past predictions landed
          </div>
        )}
        {f?.resetRisk === 'high' && (
          <div class="next-warn">Summarization likely next — a reset may drop cost sharply.</div>
        )}
      </section>
    </>
  );
}
