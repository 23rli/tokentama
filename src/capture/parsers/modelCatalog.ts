import type { ModelInfo } from '@tokentama/shared-types';

interface RawModel {
  id?: string;
  name?: string;
  vendor?: string;
  model_picker_category?: string;
  model_picker_price_category?: string;
  capabilities?: {
    family?: string;
    limits?: {
      max_context_window_tokens?: number;
      max_output_tokens?: number;
      max_prompt_tokens?: number;
    };
    supports?: { reasoning_effort?: string[]; max_thinking_budget?: number };
  };
  billing?: {
    token_prices?: {
      default?: {
        input_price?: number;
        output_price?: number;
        cache_price?: number;
        cache_write_price?: number;
        context_max?: number;
      };
    };
  };
}

/**
 * Parse Copilot's `models.json` catalog (the same data shown in the model
 * picker) into a map of model id → pricing + capabilities. Credits-per-1M-tokens
 * come from `billing.token_prices.default`.
 */
export function parseModelCatalog(content: string): Map<string, ModelInfo> {
  const catalog = new Map<string, ModelInfo>();
  if (!content.trim()) return catalog;

  let arr: RawModel[];
  try {
    const parsed = JSON.parse(content) as RawModel[] | { data?: RawModel[] };
    arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : [];
  } catch {
    return catalog;
  }

  for (const m of arr) {
    if (!m?.id) continue;
    const price = m.billing?.token_prices?.default;
    catalog.set(m.id, {
      id: m.id,
      family: m.capabilities?.family ?? m.id,
      vendor: m.vendor,
      name: m.name,
      maxOutputTokens: m.capabilities?.limits?.max_output_tokens,
      category: m.model_picker_category,
      priceCategory: m.model_picker_price_category,
      inputPer1M: price?.input_price,
      outputPer1M: price?.output_price,
      cacheReadPer1M: price?.cache_price,
      cacheWritePer1M: price?.cache_write_price,
      contextMaxTokens: m.capabilities?.limits?.max_context_window_tokens ?? price?.context_max,
      reasoningEfforts: m.capabilities?.supports?.reasoning_effort,
      maxThinkingBudget: m.capabilities?.supports?.max_thinking_budget,
    });
  }
  return catalog;
}

/** Enrich the session's selected model with catalog pricing/capabilities (by id, then family). */
export function resolveModel(
  selected: ModelInfo | undefined,
  catalog: Map<string, ModelInfo>,
): ModelInfo | undefined {
  if (!selected) return undefined;
  const byId = catalog.get(selected.id);
  if (byId) return { ...selected, ...byId, name: selected.name ?? byId.name };
  for (const entry of catalog.values()) {
    if (entry.family && entry.family === selected.family) {
      return { ...selected, ...entry, name: selected.name ?? entry.name };
    }
  }
  return selected;
}
