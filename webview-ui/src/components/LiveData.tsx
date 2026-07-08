import type { TamaState } from '../../../src/webview/contract';
import { fmtNum } from '../format';

/**
 * The model/agent context: which model, reasoning effort, and context window are
 * live in this session. Cost/token numbers live in the forecast + session-cost
 * cards, so they're deliberately NOT repeated here.
 */
export function LiveData({ state }: { state: TamaState }) {
  const m = state.model;
  const e = state.lastEvent;
  const efforts = m?.reasoningEfforts ?? [];
  // Prefer the effort the session ACTUALLY selected; fall back to the model's
  // supported range only when the concrete choice isn't recorded.
  const reasoning =
    m?.reasoningEffort ??
    (efforts.length > 1 ? `${efforts[0]}\u2013${efforts[efforts.length - 1]}` : efforts[0]);

  const agent = m ? [m.name ?? m.id, m.category].filter(Boolean).join(' · ') : undefined;
  const reasoningLine = m
    ? [reasoning, m.contextMaxTokens ? `${fmtNum(m.contextMaxTokens)} ctx` : null]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  return (
    <section class="livedata">
      <div class="livedata-head">
        <span class="livedata-title">Live Copilot data</span>
        {e && (
          <span class={`pill ${e.tokensReal ? 'pill-real' : ''}`}>
            {e.tokensReal ? 'real tokens' : 'estimated'}
          </span>
        )}
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
