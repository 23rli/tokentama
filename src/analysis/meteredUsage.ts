import type { PromptEvent, TokenEstimate } from '@tokentama/shared-types';

export interface MeteredTokenParts {
  input: number;
  output: number;
  total: number;
  inputMetered: boolean;
  outputMetered: boolean;
  anyMetered: boolean;
  fullyMetered: boolean;
  partial: boolean;
}

export interface MeteredUsageSummary {
  input: number;
  output: number;
  total: number;
  measuredTurns: number;
  partialTurns: number;
  partial: boolean;
}

/** Keep independently metered token directions and discard only local estimates. */
export function meteredTokenParts(tokens: TokenEstimate | undefined): MeteredTokenParts {
  if (!tokens) return emptyParts();
  // Older normalized events predate direction-specific flags. Their `estimated`
  // flag meant the input was missing; when false, both stored values were treated
  // as metered. New events always supply the two explicit flags.
  const inputMetered = tokens.inputEstimated != null
    ? !tokens.inputEstimated
    : tokens.estimated === false;
  const outputMetered = tokens.outputEstimated != null
    ? !tokens.outputEstimated
    : tokens.estimated === false;
  const input = inputMetered ? safeCount(tokens.inputTokens) : 0;
  const output = outputMetered ? safeCount(tokens.outputTokens) : 0;
  const anyMetered = inputMetered || outputMetered;
  const fullyMetered = inputMetered && outputMetered;
  return {
    input,
    output,
    total: input + output,
    inputMetered,
    outputMetered,
    anyMetered,
    fullyMetered,
    partial: anyMetered && !fullyMetered,
  };
}

export function summarizeMeteredUsage(events: readonly PromptEvent[]): MeteredUsageSummary {
  let input = 0;
  let output = 0;
  let measuredTurns = 0;
  let partialTurns = 0;
  for (const event of events) {
    const parts = meteredTokenParts(event.tokens);
    if (!parts.anyMetered) continue;
    measuredTurns += 1;
    if (parts.partial) partialTurns += 1;
    input += parts.input;
    output += parts.output;
  }
  return {
    input,
    output,
    total: input + output,
    measuredTurns,
    partialTurns,
    partial: partialTurns > 0,
  };
}

function emptyParts(): MeteredTokenParts {
  return {
    input: 0,
    output: 0,
    total: 0,
    inputMetered: false,
    outputMetered: false,
    anyMetered: false,
    fullyMetered: false,
    partial: false,
  };
}

function safeCount(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}