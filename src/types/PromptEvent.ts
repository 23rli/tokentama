/** Where a captured prompt/turn originated. */
export type IngestionSource = 'github-copilot-chat';

/** A single tool/function invocation observed during a turn. */
export interface ToolCallInfo {
  toolName: string;
  toolCallId?: string;
  durationMs?: number;
  success?: boolean;
  /** Broad execution surface inferred from the transcript tool identifier. */
  toolKind?: 'mcp' | 'local';
  /** Skills whose SKILL.md files were loaded by this call. Raw arguments are never retained. */
  loadedSkills?: string[];
}

/** Model identity + limits, sourced from VS Code chat session metadata / models.json. */
export interface ModelInfo {
  id: string;
  family: string;
  vendor?: string;
  name?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  /** Picker labels from models.json (e.g. 'powerful', 'high'). */
  category?: string;
  priceCategory?: string;
  /** Credits per 1M tokens (from models.json billing.token_prices.default). */
  inputPer1M?: number;
  outputPer1M?: number;
  cacheReadPer1M?: number;
  cacheWritePer1M?: number;
  contextMaxTokens?: number;
  /** Reasoning-effort levels the model SUPPORTS (from models.json capabilities). */
  reasoningEfforts?: string[];
  /** The reasoning/thinking effort actually SELECTED for this session (e.g. 'high'). */
  reasoningEffort?: string;
  maxThinkingBudget?: number;
}

/**
 * Token + cost data for a turn. Copilot's on-disk prompt/completion counts are
 * used when available; a local tokenizer is the clearly-labelled fallback.
 * Credit estimates use the per-model rates Copilot ships in models.json.
 */
export interface TokenEstimate {
  inputTokens: number;
  outputTokens: number;
  /** True when inputTokens came from local text estimation rather than Copilot. */
  inputEstimated?: boolean;
  /** True when outputTokens came from local text estimation rather than Copilot. */
  outputEstimated?: boolean;
  cachedTokens?: number;
  estimatedCostUsd: number;
  /** Estimated Copilot credits (AICs) for the turn — the objective cost unit. */
  estimatedCredits?: number;
  /** Real Copilot credits metered for the turn, when available from disk. */
  copilotCredits?: number;
  /** Legacy shorthand: true when the input side is estimated. */
  estimated: boolean;
  /** Where the input (prompt) tokens went, from Copilot's promptTokenDetails. */
  contextBreakdown?: ContextSlice[];
}

/** One category of the input-token breakdown (e.g. System Instructions, Messages). */
export interface ContextSlice {
  category: string;
  label: string;
  /** Percentage of the whole prompt (input) this slice occupies (0..100). */
  pct: number;
  /** Absolute input tokens attributed to this slice. */
  tokens: number;
}

/**
 * The transient normalized unit read from a source before content-free ledger
 * projection and live forecasting.
 * One PromptEvent ≈ one user turn (prompt + resulting assistant response + tools).
 */
export interface PromptEvent {
  eventId: string;
  sessionId: string;
  /** Source-native request identity for adapter deduplication; never exported raw. */
  sourceRequestId?: string;
  userId: string;
  turnIndex: number;
  source: IngestionSource;
  /** ISO-8601 capture time. */
  timestamp: string;
  promptText: string;
  responseText?: string;
  toolCalls: ToolCallInfo[];
  model?: ModelInfo;
  tokens?: TokenEstimate;
  /** Source lifecycle/coverage, distinct from local token estimates. */
  meteringStatus?: 'metered' | 'input-only' | 'output-only' | 'pending' | 'unavailable';
}
