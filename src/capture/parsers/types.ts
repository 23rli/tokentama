import type {
  PromptEvent,
  IngestionSource,
  ToolCallInfo,
  ModelInfo,
} from '@ecoprompt/shared-types';

export type PromptEventHandler = (event: PromptEvent) => void;

/** Every ingestion source implements this. Adapters emit normalized PromptEvents. */
export interface IngestionAdapter {
  readonly source: IngestionSource;
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  /** Subscribe to prompt events. Returns an unsubscribe function. */
  onPromptEvent(handler: PromptEventHandler): () => void;
}

/** A reconstructed user turn from a transcript JSONL (prompt + response + tools). */
export interface ParsedTurn {
  turnIndex: number;
  /** The user's prompt for this turn, from a `user.message` event. */
  promptText?: string;
  responseText: string;
  toolCalls: ToolCallInfo[];
  startTime?: string;
  endTime?: string;
}

export interface ParsedTranscript {
  sessionId: string;
  turns: ParsedTurn[];
}

/** A reconstructed user request from a chatSession JSONL. */
export interface ParsedChatRequest {
  turnIndex: number;
  promptText: string;
  /** Real output token count from `requests[i].completionTokens`, when present. */
  completionTokens?: number;
  elapsedMs?: number;
}

export interface ParsedChatSession {
  sessionId: string;
  model?: ModelInfo;
  requests: ParsedChatRequest[];
  /** Total number of requests in the session (incl. ones with no extractable prompt). */
  requestCount?: number;
}
