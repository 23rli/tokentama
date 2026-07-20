import { randomUUID } from 'node:crypto';
import type {
  PromptEvent,
  IngestionSource,
  ToolCallInfo,
  ModelInfo,
  ContextSlice,
} from '@tokentama/shared-types';
import { estimateTokens, estimateCostUsd, estimateCredits } from '@tokentama/scoring-engine';

export interface BuildPromptEventInput {
  source: IngestionSource;
  sessionId: string;
  sourceRequestId?: string;
  userId: string;
  turnIndex: number;
  promptText: string;
  responseText?: string;
  toolCalls?: ToolCallInfo[];
  model?: ModelInfo;
  modelFamily?: string;
  timestamp?: string;
  /** Use a real token count when available (e.g. chatSession completionTokens). */
  inputTokensOverride?: number;
  outputTokensOverride?: number;
  /** Real Copilot credits metered for the turn, when available from disk. */
  copilotCredits?: number;
  /** Whether the source request has completed even if it omitted usage fields. */
  sourceCompleted?: boolean;
  /** Per-category input-token breakdown from Copilot's promptTokenDetails. */
  contextBreakdown?: ContextSlice[];
}

/**
 * Conservative estimate of a turn's CACHED input: the system instructions + tool
 * definitions are byte-identical every turn, so from turn 2 on they're served from
 * the prompt cache (~10% of the fresh rate). We count only this stable prefix (not
 * prior messages, which are also cached) to avoid over-crediting the cache.
 */
function cachedInputEstimate(turnIndex: number, breakdown?: ContextSlice[]): number {
  if (turnIndex <= 0 || !breakdown) return 0;
  return breakdown
    .filter((s) => /system|tool/i.test(s.category) || /system|tool/i.test(s.label))
    .reduce((sum, s) => sum + (s.tokens ?? 0), 0);
}

/** Build a normalized, self-contained PromptEvent with token + cost estimates. */
export function buildPromptEvent(input: BuildPromptEventInput): PromptEvent {
  const inputTokens = input.inputTokensOverride ?? estimateTokens(input.promptText);
  const outputTokens = input.outputTokensOverride ?? estimateTokens(input.responseText);
  const inputEstimated = input.inputTokensOverride == null;
  const outputEstimated = input.outputTokensOverride == null;
  const meteringStatus: PromptEvent['meteringStatus'] =
    !inputEstimated && !outputEstimated
      ? 'metered'
      : !inputEstimated
        ? 'input-only'
        : !outputEstimated
          ? 'output-only'
          : input.sourceCompleted
            ? 'unavailable'
            : 'pending';
  const family = input.model?.family ?? input.modelFamily;
  const estimatedCostUsd = estimateCostUsd(inputTokens, outputTokens, family);

  const model: ModelInfo | undefined = input.model ?? (family ? { id: family, family } : undefined);
  const cachedInput = cachedInputEstimate(input.turnIndex, input.contextBreakdown);

  return {
    eventId: randomUUID(),
    sessionId: input.sessionId,
    sourceRequestId: input.sourceRequestId,
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
      inputEstimated,
      outputEstimated,
      estimatedCostUsd,
      estimatedCredits: estimateCredits(inputTokens, outputTokens, model, cachedInput),
      copilotCredits: input.copilotCredits,
      estimated: inputEstimated,
      contextBreakdown: input.contextBreakdown,
    },
    meteringStatus,
  };
}
