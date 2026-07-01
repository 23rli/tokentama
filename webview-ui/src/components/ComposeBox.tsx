import { useEffect, useRef, useState } from 'preact/hooks';
import type { AutoRewriteView, ComposeResult } from '../../../src/webview/contract';
import { post } from '../vscodeApi';

/**
 * In-the-moment coaching surface we fully own: as the user drafts a prompt here,
 * we debounce-score it with the offline engine (no network, no state change) and
 * offer a leaner rewrite before it ever reaches Copilot. An on-demand "rewrite in
 * my style" action produces a corpus-informed rewrite (offline, or a cheap model).
 */
export function ComposeBox({ result, auto }: { result?: ComposeResult; auto?: AutoRewriteView }) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const draft = text;
    timer.current = window.setTimeout(() => post({ type: 'composeInput', text: draft }), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text]);

  // An arriving auto-rewrite for the current draft clears the pending state.
  useEffect(() => {
    if (auto && auto.text === text) setPending(false);
  }, [auto, text]);

  const matches = result != null && result.text === text && text.trim().length > 0;
  const score = matches ? Math.round(result!.overallScore) : undefined;
  const scoreClass = score == null ? '' : score >= 60 ? 'high' : score >= 30 ? 'mid' : 'low';
  const retryRisk = matches ? result!.retryRisk : undefined;
  const retryReason = matches ? result!.retryReasons?.[0] : undefined;

  const autoMatches = auto != null && auto.text === text;
  const autoRewrite = autoMatches ? auto!.rewrittenPrompt : undefined;
  // Prefer the corpus-informed auto rewrite; fall back to the live heuristic one.
  const rewrite = autoRewrite ?? (matches ? result!.rewrittenPrompt : undefined);
  const rewriteFromAuto = autoRewrite != null;
  const savingsPct = rewriteFromAuto
    ? auto!.estimatedTokenReductionPct
    : matches
      ? result!.estimatedTokenReductionPct
      : undefined;

  const requestRewrite = (): void => {
    if (!text.trim()) return;
    setPending(true);
    post({ type: 'autoRewrite', text });
  };

  return (
    <section class="compose">
      <div class="compose-head">
        <span class="section-title">Compose</span>
        {score != null && <span class={`compose-score compose-${scoreClass}`}>{score}</span>}
      </div>

      <textarea
        class="compose-input"
        rows={3}
        placeholder="Draft a prompt here — Tokentama scores it live and can rewrite it leaner before you send it to Copilot."
        value={text}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
      />

      {matches && result!.tip && <p class="compose-tip">💡 {result!.tip}</p>}

      {(retryRisk === 'high' || retryRisk === 'medium') && (
        <p class={`retry-risk retry-${retryRisk}`}>
          ⚠️ {retryRisk === 'high' ? 'High' : 'Some'} retry risk{retryReason ? ` — ${retryReason}` : ''}.
          Add specifics or use “Rewrite in my style” to land on the first try.
        </p>
      )}

      {rewrite && (
        <div class="compose-rewrite">
          <div class="rewrite-head">
            {rewriteFromAuto ? 'Rewrite in your style' : 'Suggested rewrite'}
            {rewriteFromAuto && auto!.source === 'llm' && auto!.examplesUsed > 0 && (
              <span class="rewrite-badge"> · {auto!.examplesUsed} examples</span>
            )}
          </div>
          <pre class="rewrite-body">{rewrite}</pre>
          {savingsPct != null && (
            <p class="rewrite-savings">Saves ~{Math.round(savingsPct)}% tokens</p>
          )}
          {savingsPct == null && rewriteFromAuto && auto!.clarified && (
            <p class="rewrite-savings">+ context to land on the first try — avoids a retry</p>
          )}
        </div>
      )}

      {text.trim() && (
        <div class="compose-actions">
          <button class="primary" onClick={requestRewrite} disabled={pending}>
            {pending ? '✨ Rewriting…' : '✨ Rewrite in my style'}
          </button>
          {rewrite && (
            <button
              class="ghost"
              onClick={() => post({ type: 'copyToCopilot', text: rewrite, adopted: true })}
            >
              Copy rewrite
            </button>
          )}
          <button class="ghost" onClick={() => post({ type: 'copyToCopilot', text, adopted: false })}>
            Copy my prompt
          </button>
        </div>
      )}
    </section>
  );
}
