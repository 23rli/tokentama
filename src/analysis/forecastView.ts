import type { Forecast } from './forecast';
import type { ForecastAccuracy } from './forecastService';
import type { ForecastView } from '../webview/contract';
import type { PromptEvent, ContextSlice } from '@tokentama/shared-types';
import { estimateCredits } from '@tokentama/scoring-engine';

export interface ForecastViewExtras {
  sessionShortId?: string;
  sessionTitle?: string;
  lastPromptPreview?: string;
  turnCount: number;
  contextSeries: number[];
  turnPrompts?: string[];
  realLastInputTokens?: number;
  realLastCredits?: number;
  contextBreakdown?: ContextSlice[];
  contextInputTokens?: number;
  sessionBreakdown?: ContextSlice[];
  sessionInputTokens?: number;
  chatBreakdown?: ContextSlice[];
  chatInputTokens?: number;
  chatSessionCount?: number;
  chatTotalTokens?: number;
  chatCredits?: number;
  chatCreditsEstimated?: boolean;
  chatCostUsd?: number;
  allTurns?: { prompt: string; tokens: number; metered: boolean }[];
}

/**
 * Assemble the webview forecast view-model: the PREDICTED next turn (+ interval,
 * reset risk, hungriest part), the REAL last turn to compare against, the live
 * self-measured accuracy, and the context-load / sustainability band. Predicted
 * credits price the fresh (growth+draft) portion at the input rate and treat
 * carried context as cached. Pure (no VS Code / disk) so it's unit-testable.
 */
export function buildForecastView(
  f: Forecast,
  acc: ForecastAccuracy,
  event: PromptEvent,
  extras: ForecastViewExtras,
): ForecastView {
  const contextTokens = f.breakdown.carriedContext;
  // Use the FULL context window (contextMaxTokens, e.g. 1M) as the limit so the
  // percentage matches what GitHub Copilot shows, not the input-only cap.
  const limit = event.model?.contextMaxTokens ?? event.model?.maxInputTokens;
  const loadFraction = limit && limit > 0 ? contextTokens / limit : undefined;
  const expectedOutput = event.tokens?.outputTokens ?? 0;
  const predictedCredits = event.model
    ? estimateCredits(f.predictedInputTokens, expectedOutput, event.model, contextTokens)
    : undefined;

  const sustainability: ForecastView['sustainability'] =
    f.resetRisk === 'high' || (loadFraction ?? 0) >= 0.9
      ? 'overloaded'
      : (loadFraction ?? 0) >= 0.75
        ? 'critical'
        : (loadFraction ?? 0) >= 0.5
          ? 'heavy'
          : (loadFraction ?? 0) >= 0.3
            ? 'moderate'
            : 'light';

  return {
    predictedInputTokens: f.predictedInputTokens,
    intervalLow: f.interval.low,
    intervalHigh: f.interval.high,
    predictedCredits,
    confidence: f.confidence,
    resetRisk: f.resetRisk,
    hungriest: f.hungriest,
    realLastInputTokens: extras.realLastInputTokens,
    realLastCredits: extras.realLastCredits,
    accuracyScore: acc.score,
    accuracySamples: acc.samples,
    intervalCoverage: acc.intervalCoverage,
    contextTokens,
    contextLimit: limit,
    loadFraction,
    sustainability,
    sessionShortId: extras.sessionShortId,
    sessionTitle: extras.sessionTitle,
    lastPromptPreview: extras.lastPromptPreview,
    turnCount: extras.turnCount,
    contextSeries: extras.contextSeries,
    turnPrompts: extras.turnPrompts,
    contextBreakdown: extras.contextBreakdown,
    contextInputTokens: extras.contextInputTokens,
    sessionBreakdown: extras.sessionBreakdown,
    sessionInputTokens: extras.sessionInputTokens,
    chatBreakdown: extras.chatBreakdown,
    chatInputTokens: extras.chatInputTokens,
    chatSessionCount: extras.chatSessionCount,
    chatTotalTokens: extras.chatTotalTokens,
    chatCredits: extras.chatCredits,
    chatCreditsEstimated: extras.chatCreditsEstimated,
    chatCostUsd: extras.chatCostUsd,
    allTurns: extras.allTurns,
  };
}
