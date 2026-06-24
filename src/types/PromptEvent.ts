/** Where a captured prompt/turn originated. */
export type IngestionSource = 'transcript' | 'chat-session' | 'manual' | 'scripted';

/** A single tool/function invocation observed during a turn. */
export interface ToolCallInfo {
  toolName: string;
  toolCallId?: string;
  durationMs?: number;
  success?: boolean;
}

/** Model identity + limits, sourced from VS Code chat session metadata / models.json. */
export interface ModelInfo {
  id: string;
  family: string;
  vendor?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

/**
 * Token + cost estimate for a turn. Counts are estimated with a tokenizer
 * (they are not metered on disk) but priced with the REAL per-model rates that
 * Copilot ships in models.json. `estimated` is therefore almost always true.
 */
export interface TokenEstimate {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  estimatedCostUsd: number;
  /** Real Copilot credits metered for the turn, when available from disk. */
  copilotCredits?: number;
  estimated: boolean;
}

/**
 * The normalized unit produced by every ingestion adapter and fed into scoring.
 * One PromptEvent ≈ one user turn (prompt + resulting assistant response + tools).
 */
export interface PromptEvent {
  eventId: string;
  sessionId: string;
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
  /** Number of near-duplicate retries detected earlier in this session. */
  retryCountInSession?: number;
  /** Whether the user adopted the previous coaching suggestion (behavioral hint). */
  adoptedPreviousTip?: boolean;
}
