import type { ForecastView } from '../../../src/webview/contract';
import { fmtNum } from '../format';

/**
 * The hero card. Answers three questions at a glance, flat/business style:
 *   WHERE ARE WE  — which session + turn, and the last captured prompt.
 *   WHAT'S NEXT   — the PREDICTED next-turn cost (the big number) + range.
 *   VS REALITY    — the REAL last-turn cost + the system's live accuracy.
 * Always renders (skeleton before data) so the layout never shifts.
 */
export function ForecastPanel({ forecast }: { forecast?: ForecastView }) {
  const f = forecast;
  const acc = f && f.accuracySamples > 0 ? `${Math.round(f.accuracyScore)}/100` : '—';

  return (
    <section class="card fc">
      <header class="fc-top">
        <span class="fc-track">TRACKING</span>
        <span class="fc-sid">
          {f?.sessionShortId ? `session ${f.sessionShortId}` : 'no active session'}
          {f && f.turnCount > 0 ? ` · turn ${f.turnCount}` : ''}
        </span>
        <span class="fc-acc" title="Live self-measured accuracy on your real turns">
          acc {acc}
        </span>
      </header>

      <p class={`fc-prompt${f?.lastPromptPreview ? '' : ' muted'}`}>
        {f?.lastPromptPreview ? `“${f.lastPromptPreview}”` : 'Waiting for your first Copilot turn…'}
      </p>

      <div class="fc-hero">
        <span class="fc-kicker">PREDICTED NEXT TURN</span>
        <div class="fc-num-row">
          <span class={`fc-number${f ? '' : ' muted'}`}>{f ? fmtNum(f.predictedInputTokens) : '—'}</span>
          <span class="fc-unit">tokens in</span>
        </div>
        <div class="fc-range">
          {f ? (
            <>
              range {fmtNum(f.intervalLow)}–{fmtNum(f.intervalHigh)}
              {f.predictedCredits != null && <> · ~{Math.round(f.predictedCredits).toLocaleString()} AIC</>}
              {f.confidence < 0.4 && <span class="fc-hedge"> · low confidence</span>}
            </>
          ) : (
            'range —'
          )}
        </div>
      </div>

      <div class="fc-real">
        <span class="fc-real-k">REAL last turn</span>
        <span class="fc-real-v">
          {f?.realLastInputTokens != null ? `${fmtNum(f.realLastInputTokens)} tokens` : '—'}
        </span>
        {f?.realLastCredits != null && (
          <span class="fc-real-c">{Math.round(f.realLastCredits).toLocaleString()} AIC</span>
        )}
      </div>

      {f?.resetRisk === 'high' && (
        <div class="fc-warn">
          Summarization likely next — the estimate is unreliable at the context limit; cost may drop
          sharply after a reset.
        </div>
      )}
    </section>
  );
}
