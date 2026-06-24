import type { ModelInfo } from '../../../src/webview/contract';
import { fmtNum } from '../format';

export function ModelCard({ model }: { model?: ModelInfo }) {
  if (!model) return null;
  const rate = (n?: number): string => (n == null ? '—' : `${n}`);

  return (
    <section class="modelcard">
      <div class="modelcard-head">
        <span class="modelcard-name">{model.name ?? model.id}</span>
        {model.category && <span class="pill">{model.category}</span>}
        {model.priceCategory && <span class="pill">{model.priceCategory} cost</span>}
      </div>

      <div class="modelcard-rates">
        <div class="rate">
          <span class="muted">input /1M</span>
          <strong>{rate(model.inputPer1M)}</strong>
        </div>
        <div class="rate">
          <span class="muted">output /1M</span>
          <strong>{rate(model.outputPer1M)}</strong>
        </div>
        <div class="rate">
          <span class="muted">cache /1M</span>
          <strong>{rate(model.cacheReadPer1M)}</strong>
        </div>
      </div>

      <div class="modelcard-meta muted">
        {model.contextMaxTokens != null && <span>ctx {fmtNum(model.contextMaxTokens)}</span>}
        {model.maxOutputTokens != null && <span> · out {fmtNum(model.maxOutputTokens)}</span>}
        {model.reasoningEfforts?.length ? <span> · reasoning {model.reasoningEfforts.join('/')}</span> : null}
      </div>
    </section>
  );
}
