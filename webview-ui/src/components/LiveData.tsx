import type { TokenLensState } from '../../../src/webview/contract';
import { fmtNum } from '../format';
import { Tip } from './Tip';

/**
 * The model/agent context: which model, reasoning effort, and context window are
 * live in this session. Cost/token numbers live in the forecast + session-cost
 * cards, so they're deliberately NOT repeated here.
 */
export function LiveData({ state }: { state: TokenLensState }) {
  const m = state.model;
  // Only show the reasoning effort when the session ACTUALLY recorded which one
  // was selected. Never show the supported range (e.g. "low–max") — that reads
  // like the model is using a range, which is wrong and confusing.
  const reasoning = m?.reasoningEffort;

  const agent = m ? [m.name ?? m.id, m.category].filter(Boolean).join(' · ') : undefined;
  const reasoningLine = m
    ? [reasoning, m.contextMaxTokens ? `${fmtNum(m.contextMaxTokens)} ctx` : null]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  return (
    <section class="card livedata">
      <div class="livedata-head">
        <Tip text="The model and reasoning effort in use. Premium models typically have higher rates, and more reasoning can increase total turn cost — match the model to the task.">
          <span class="section-title" role="heading" aria-level={2}>Live Copilot data</span>
        </Tip>
      </div>

      <div class="livedata-row">
        <span class="livedata-key">Agent</span>
        <span class="livedata-val">{agent ?? 'waiting for a Copilot prompt…'}</span>
      </div>

      {reasoningLine && (
        <div class="livedata-row">
          <span class="livedata-key">Reasoning</span>
          <span class="livedata-val">{reasoningLine}</span>
        </div>
      )}
    </section>
  );
}
