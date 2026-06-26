import type {
  ScorePromptRequest,
  ScorePromptResponse,
  TokenEstimate,
  WasteCategory,
} from '@tokentama/shared-types';
import type { DetectorInput } from './heuristics/types';
import { computeWaste } from './calculators/wasteScore';
import { computeSubscores } from './calculators/subscores';
import { scoreToState } from './transitions/petStateMachine';
import { clampScore } from './text/similarity';
import { estimateTokens } from './models/tokenizer';
import { estimateCostUsd } from './models/pricing';

export interface ScoreOptions {
  /** Previous overall score in the session, used for delta + recovery. */
  previousScore?: number | null;
  /** Whether a coaching tip was shown before this prompt. */
  hadPreviousTip?: boolean;
}

export function buildDetectorInput(req: ScorePromptRequest): DetectorInput {
  return {
    promptText: req.promptText ?? '',
    responseText: req.responseText,
    toolCalls: req.toolCalls ?? [],
    recentPrompts: req.recentPrompts ?? [],
    adoptedPreviousTip: req.adoptedPreviousTip,
    hadPreviousTip: req.adoptedPreviousTip !== undefined,
    metadata: req.metadata,
  };
}

export function estimateTokenUsage(req: ScorePromptRequest): TokenEstimate {
  const inputTokens = req.metadata?.estimatedInputTokens ?? estimateTokens(req.promptText);
  const outputTokens = req.metadata?.estimatedOutputTokens ?? estimateTokens(req.responseText);
  const estimatedCostUsd = estimateCostUsd(inputTokens, outputTokens, req.metadata?.modelName);
  return { inputTokens, outputTokens, estimatedCostUsd, estimated: true };
}

/** Core scoring entry point. Pure and deterministic. */
export function scorePrompt(req: ScorePromptRequest, opts: ScoreOptions = {}): ScorePromptResponse {
  const input = buildDetectorInput(req);
  if (opts.hadPreviousTip !== undefined) input.hadPreviousTip = opts.hadPreviousTip;

  const waste = computeWaste(input);
  const overallScore = clampScore(100 - waste.wasteScore);
  const subscores = computeSubscores(waste.results, waste.structure, {
    adoptedPreviousTip: req.adoptedPreviousTip,
    hadPreviousTip: input.hadPreviousTip,
  });
  const petState = scoreToState(overallScore);

  const previousScore = opts.previousScore ?? null;
  const delta = previousScore == null ? 0 : Math.round(overallScore - previousScore);

  const reasons: string[] = [];
  const improvements: string[] = [];
  const ordered = [...waste.components].sort((a, b) => b.weightedPoints - a.weightedPoints);
  for (const c of ordered) {
    if (c.severity <= 0.25) continue;
    if (c.weightedPoints <= 0) continue; // skip categories excluded from the score (e.g. tool overuse)
    const r = waste.results[c.category];
    if (!r) continue;
    if (r.reason) reasons.push(r.reason);
    if (r.improvement) improvements.push(r.improvement);
  }
  if (reasons.length === 0) {
    reasons.push('Efficient prompt — clear task, little avoidable waste detected.');
  }

  return {
    overallScore,
    wasteScore: waste.wasteScore,
    subscores,
    reasons,
    improvements,
    petState,
    delta,
    wasteBreakdown: waste.components,
    tokens: estimateTokenUsage(req),
  };
}

/** The waste categories that materially hurt this prompt, worst-first. */
export function dominantWasteCategories(resp: ScorePromptResponse): WasteCategory[] {
  return resp.wasteBreakdown
    .filter((c) => c.severity > 0.25 && c.weightedPoints > 0)
    .sort((a, b) => b.weightedPoints - a.weightedPoints)
    .map((c) => c.category);
}
