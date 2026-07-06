import type { OutcomeReport } from '../../../src/webview/contract';
import { fmtNum } from '../format';

/**
 * Coaching outcomes — the quality loop, framed around retries (the costliest miss:
 * a re-ask re-sends the whole turn). Before enough adoption data accrues we still
 * surface the retry OPPORTUNITY; once it does, we show whether adopting coaching
 * actually lowered the retry rate (savings without a quality cost).
 */
export function OutcomesPanel({ outcomes }: { outcomes?: OutcomeReport }) {
  if (!outcomes) return null;

  const hasSignal = outcomes.hasSignal && outcomes.retryReductionPct != null;
  const retryCount = Math.round(outcomes.retryRate * outcomes.totalTurns);

  // Early state: no adoption signal yet, but re-asks are already the headline lever.
  if (!hasSignal) {
    if (outcomes.totalTurns < 4 || retryCount < 1) return null;
    const ratePct = Math.round(outcomes.retryRate * 100);
    return (
      <section class="outcomes">
        <span class="section-title">Biggest saving opportunity</span>
        <p class="outcomes-line flat">
          ~{retryCount} of your {outcomes.totalTurns} turns were re-asks ({ratePct}%). Each one
          re-sends the whole turn — landing it right the first time is where the real tokens are.
        </p>
        <p class="outcomes-sub">Use the Compose rewrite on vague asks to cut these.</p>
      </section>
    );
  }

  const positive = outcomes.retryReductionPct! > 0;
  const adopted = Math.round((outcomes.retryRateAdopted ?? 0) * 100);
  const notAdopted = Math.round((outcomes.retryRateNotAdopted ?? 0) * 100);

  return (
    <section class="outcomes">
      <span class="section-title">Coaching outcomes</span>
      <p class={`outcomes-line ${positive ? 'good' : 'flat'}`}>
        {positive
          ? `Adopting coaching cut your retry rate by ${outcomes.retryReductionPct}% — ~${fmtNum(
              outcomes.estTokensSaved,
            )} tokens (${outcomes.estRetriesAvoided} retries) avoided.`
          : `No retry reduction from adoption yet — keep collecting data.`}
      </p>
      <p class="outcomes-sub">
        retry rate: {adopted}% when adopted · {notAdopted}% when not
      </p>
      <p class="outcomes-sub">
        net saved: {fmtNum(outcomes.netTokensSaved)} tokens (−{fmtNum(outcomes.toolTokensSpent)}{' '}
        Tokentama spend)
      </p>
    </section>
  );
}
