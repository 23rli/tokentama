import type { ForecastView } from '../../../src/webview/contract';
import { fmtNum } from '../format';
import { Tip } from './Tip';

/**
 * The chat header + the two headline numbers side by side: LAST TURN (the real
 * input tokens the previous turn cost) vs NEXT TURN (est.), plus a one-line
 * range and forecast accuracy. Always renders (skeleton before data).
 */
export function ForecastPanel({ forecast }: { forecast?: ForecastView }) {
  const f = forecast;
  const name = f?.sessionTitle || (f?.sessionShortId ? `Chat ${f.sessionShortId}` : 'No active chat');
  const turns = f?.allTurns ?? [];
  const liveTurn = turns.length || f?.turnCount || 0;
  const pending = countInFlightTurns(turns);
  const estimatingPending = f?.forecastTarget === 'pending';

  return (
    <>
      <section class="card now">
        <span class="now-label" role="heading" aria-level={2}>Chat</span>
        <div class="now-row">
          <span class="now-name">{name}</span>
          {f && liveTurn > 0 && (
            <span class="now-turn">
              turn {liveTurn}
              {pending > 0 ? ` · ${pending} pending` : ''}
            </span>
          )}
        </div>
      </section>

      <section class="card next" aria-labelledby="forecast-heading">
        <h2 id="forecast-heading" class="sr-only">
          {estimatingPending ? 'Current turn estimate' : 'Next-turn forecast'}
        </h2>
        <div class="next-cols">
          <div class="next-col">
            <Tip text="The real input tokens your most recent METERED turn cost. A just-sent turn stays 'pending' until Copilot writes its real tokens.">
              <span class="next-kicker">Last metered</span>
            </Tip>
            <span class={`next-number${f?.realLastInputTokens != null ? '' : ' muted'}`}>
              {f?.realLastInputTokens != null ? fmtNum(f.realLastInputTokens) : '—'}
            </span>
          </div>
          <div class="next-arrow">→</div>
          <div class="next-col">
            <Tip text={estimatingPending ? "What the in-flight prompt is likely to cost once Copilot finishes metering it." : "What your next prompt will cost, predicted from your recent turns. It's driven by re-sent history and tool calls, not just your message length — fewer tool round-trips and a shorter chat cost less."}>
              <span class="next-kicker">{estimatingPending ? 'Current turn (est.)' : 'Next turn (est.)'}</span>
            </Tip>
            <span class={`next-number next-pred${f ? '' : ' muted'}`}>
              {f ? fmtNum(f.predictedInputTokens) : '—'}
            </span>
          </div>
        </div>

        <div class="next-detail">
          {f ? (
            <>
              {f.predictedCredits != null && <>≈ {Math.round(f.predictedCredits).toLocaleString()} credits · </>}
              range {fmtNum(f.intervalLow)}–{fmtNum(f.intervalHigh)} tokens
              {f.confidence < 0.4 && <span class="next-hedge"> · low conf.</span>}
            </>
          ) : (
            'range —'
          )}
        </div>

        {pending > 0 && (
          <div class="next-pending">
            {pending} turn{pending > 1 ? 's' : ''} in flight — showing the current turn estimate until Copilot meters {pending > 1 ? 'them' : 'it'}.
          </div>
        )}

        {f && f.accuracySamples > 0 && (
          <div class="next-acc" title={`How close past predictions landed — median error on ${f.accuracySamples} of your turns`}>
            <b class="next-acc-pct">{Math.round(f.accuracyScore)}%</b>
            <span class="next-acc-note">forecast accuracy</span>
          </div>
        )}

        {f?.resetRisk === 'high' && (
          <div class="next-warn">Context is near a possible reset zone — summarization may drop the next turn sharply.</div>
        )}
      </section>
    </>
  );
}

export function countInFlightTurns(turns: NonNullable<ForecastView['allTurns']>): number {
  return turns.filter((turn) => turn.status === 'pending').length;
}
