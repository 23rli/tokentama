import type { OutcomeReport } from '../../../src/webview/contract';
import { fmtNum } from '../format';

/**
 * Coaching outcomes — the quality loop. Compares your retry rate on turns where
 * you adopted prior coaching vs. where you didn't. A lower retry rate when adopting
 * means the savings came without a quality cost (retries are the costliest miss).
 */
export function OutcomesPanel({ outcomes }: { outcomes?: OutcomeReport }) {
  if (!outcomes?.hasSignal || outcomes.retryReductionPct == null) return null;
  const positive = outcomes.retryReductionPct > 0;
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
    </section>
  );
}
