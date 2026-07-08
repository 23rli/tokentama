import type { ForecastView } from '../../../src/webview/contract';
import { fmtNum } from '../format';

/**
 * A small session header + the two headline numbers side by side: LAST USED (the
 * real tokens the previous turn cost) vs PREDICTED NEXT, with a one-line forecast
 * accuracy (percentage first). Always renders (skeleton before data).
 */
export function ForecastPanel({ forecast }: { forecast?: ForecastView }) {
  const f = forecast;
  const name = f?.sessionTitle || (f?.sessionShortId ? `Session ${f.sessionShortId}` : 'No active session');

  return (
    <>
      <section class="card now">
        <span class="now-label">Session</span>
        <div class="now-row">
          <span class="now-name">{name}</span>
          {f && f.turnCount > 0 && <span class="now-turn">turn {f.turnCount}</span>}
        </div>
      </section>

      <section class="card next">
        <div class="next-cols">
          <div class="next-col">
            <span class="next-kicker">Last used</span>
            <span class={`next-number${f?.realLastInputTokens != null ? '' : ' muted'}`}>
              {f?.realLastInputTokens != null ? fmtNum(f.realLastInputTokens) : '—'}
            </span>
          </div>
          <div class="next-arrow">→</div>
          <div class="next-col">
            <span class="next-kicker">Predicted next</span>
            <span class={`next-number next-pred${f ? '' : ' muted'}`}>
              {f ? fmtNum(f.predictedInputTokens) : '—'}
            </span>
          </div>
        </div>

        <div class="next-detail">
          tokens in
          {f?.predictedCredits != null && <> · ≈ {Math.round(f.predictedCredits).toLocaleString()} credits next</>}
          {f && <> · likely {fmtNum(f.intervalLow)}–{fmtNum(f.intervalHigh)}</>}
          {f && f.confidence < 0.4 && <span class="next-hedge"> · low confidence</span>}
        </div>

        {f && f.accuracySamples > 0 && (
          <div class="next-acc" title={`How close past predictions landed — median error on ${f.accuracySamples} of your turns`}>
            <b class="next-acc-pct">{Math.round(f.accuracyScore)}%</b>
            <span class="next-acc-note">forecast accuracy</span>
          </div>
        )}

        {f?.resetRisk === 'high' && (
          <div class="next-warn">Summarization likely next — a reset may drop cost sharply.</div>
        )}
      </section>
    </>
  );
}
