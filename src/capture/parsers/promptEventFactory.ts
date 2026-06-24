import { randomUUID } from 'node:crypto';
import type {
  PromptEvent,
  IngestionSource,
  ToolCallInfo,
  ModelInfo,
} from '@ecoprompt/shared-types';
import { estimateTokens, estimateCostUsd } from '@ecoprompt/scoring-engine';

export interface BuildPromptEventInput {
  source: IngestionSource;
  sessionId: string;
  userId: string;
  turnIndex: number;
  promptText: string;
  responseText?: string;
  toolCalls?: ToolCallInfo[];
  model?: ModelInfo;
  modelFamily?: string;
  retryCountInSession?: number;
  adoptedPreviousTip?: boolean;
  timestamp?: string;
  /** Use a real token count when available (e.g. chatSession completionTokens). */
  inputTokensOverride?: number;
  outputTokensOverride?: number;
  /** Real Copilot credits metered for the turn, when available from disk. */
  copilotCredits?: number;
}

/** Build a normalized, self-contained PromptEvent with token + cost estimates. */
export function buildPromptEvent(input: BuildPromptEventInput): PromptEvent {
  const inputTokens = input.inputTokensOverride ?? estimateTokens(input.promptText);
  const outputTokens = input.outputTokensOverride ?? estimateTokens(input.responseText);
  const family = input.model?.family ?? input.modelFamily;
  const estimatedCostUsd = estimateCostUsd(inputTokens, outputTokens, family);

  const model: ModelInfo | undefined = input.model ?? (family ? { id: family, family } : undefined);

  return {
    eventId: randomUUID(),
    sessionId: input.sessionId,
    userId: input.userId,
    turnIndex: input.turnIndex,
    source: input.source,
    timestamp: input.timestamp ?? new Date().toISOString(),
    promptText: input.promptText,
    responseText: input.responseText,
    toolCalls: input.toolCalls ?? [],
    model,
    tokens: {
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      copilotCredits: input.copilotCredits,
      estimated: input.inputTokensOverride == null,
    },
    retryCountInSession: input.retryCountInSession,
    adoptedPreviousTip: input.adoptedPreviousTip,
  };
}
