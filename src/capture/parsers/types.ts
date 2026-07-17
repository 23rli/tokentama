import type {
  PromptEvent,
  IngestionSource,
  ToolCallInfo,
  ModelInfo,
} from '@tokentama/shared-types';

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
  /** Stable creation time from `session.start`, used for the omitted first prompt. */
  startTime?: string;
  turns: ParsedTurn[];
}

/** A reconstructed user request from a chatSession JSONL. */
export interface ParsedChatRequest {
  turnIndex: number;
  promptText: string;
  requestId?: string;
  timestamp?: string;
  promptTokens?: number;
  /** Real output token count from `requests[i].completionTokens`, when present. */
  completionTokens?: number;
  copilotCredits?: number;
  promptTokenDetails?: Array<{
    category: string;
    label: string;
    percentageOfPrompt: number;
  }>;
  completed: boolean;
  elapsedMs?: number;
}

export interface ParsedChatSession {
  sessionId: string;
  /** The chat's custom title, when the user/agent named it. */
  title?: string;
  model?: ModelInfo;
  requests: ParsedChatRequest[];
  /** Total number of requests in the session (incl. ones with no extractable prompt). */
  requestCount?: number;
}
