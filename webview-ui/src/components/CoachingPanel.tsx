import type { ScoredEventView, TipView } from '../../../src/webview/contract';
import { post } from '../vscodeApi';

interface Props {
  tip?: TipView;
  lastEvent?: ScoredEventView;
}

export function CoachingPanel({ tip, lastEvent }: Props) {
  const improvements = lastEvent?.improvements ?? [];

  if (!tip && improvements.length === 0) {
    return (
      <section class="coaching">
        <h3 class="section-title">Coaching</h3>
        <p class="empty">Efficient prompts won't trigger coaching. Keep it lean!</p>
      </section>
    );
  }

  return (
    <section class="coaching">
      <h3 class="section-title">Coaching</h3>

      {tip && <p class="tip-message">{tip.message}</p>}

      {improvements.length > 0 && (
        <ul class="tip-improvements">
          {improvements.slice(0, 2).map((imp, i) => (
            <li key={i}>{imp}</li>
          ))}
        </ul>
      )}

      {tip?.rewrittenPrompt && (
        <div class="rewrite">
          <div class="rewrite-head">Suggested rewrite</div>
          <pre class="rewrite-body">{tip.rewrittenPrompt}</pre>
          <div class="rewrite-actions">
            <button
              class="primary"
              onClick={() => post({ type: 'applyTip', rewrittenPrompt: tip.rewrittenPrompt! })}
            >
              Copy rewrite
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
