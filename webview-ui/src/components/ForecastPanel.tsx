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
  const pending = turns.filter((t) => !t.metered).length;

  return (
    <>
      <section class="card now">
        <span class="now-label">Chat</span>
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

      <section class="card next">
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
            <Tip text="What your next prompt will cost, predicted from your recent turns.">
              <span class="next-kicker">Next turn (est.)</span>
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
            {pending} turn{pending > 1 ? 's' : ''} in flight — the estimate updates once Copilot meters {pending > 1 ? 'them' : 'it'}.
          </div>
        )}

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
