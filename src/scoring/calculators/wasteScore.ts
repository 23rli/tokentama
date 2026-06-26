import type { WasteCategory, WasteComponent } from '@tokentama/shared-types';
import type { DetectorInput, DetectorResult, StructureSignal } from '../heuristics/types';
import { WASTE_DETECTORS, detectStructuredPrompt } from '../heuristics';
import { clamp01 } from '../text/similarity';

/**
 * Waste category weights. The headline EcoScore is driven by four prompt-quality
 * factors the user controls: duplicate context (redundantContext + retryLoop),
 * vagueness, verbosity, and ignoring coaching. Weights lean toward the stable,
 * prompt-intrinsic factors (vagueness + verbosity) so similar prompts score
 * similarly. Tool overuse is intentionally excluded (weight 0). Sum = 1.0.
 */
export const WASTE_WEIGHTS: Record<WasteCategory, number> = {
  redundantContext: 0.3,
  retryLoop: 0.25,
  vagueness: 0.2,
  verbosityMismatch: 0.15,
  ignoredCoaching: 0.1,
  toolOveruse: 0,
};

export interface WasteResult {
  /** 0..100, higher = more avoidable waste. */
  wasteScore: number;
  components: WasteComponent[];
  results: Record<WasteCategory, DetectorResult>;
  structure: StructureSignal;
}

export function computeWaste(input: DetectorInput): WasteResult {
  const structure = detectStructuredPrompt(input);
  const results = {} as Record<WasteCategory, DetectorResult>;
  const components: WasteComponent[] = [];
  let wasteScore = 0;

  for (const detector of WASTE_DETECTORS) {
    const result = detector.detect(input);
    let severity = clamp01(result.severity);

    // Good structure mitigates perceived vagueness.
    if (detector.category === 'vagueness') {
      severity = clamp01(severity * (1 - 0.6 * structure.structureScore));
    }

    const weight = WASTE_WEIGHTS[detector.category];
    const weightedPoints = severity * weight * 100;
    wasteScore += weightedPoints;

    results[detector.category] = { ...result, severity };
    components.push({
      category: detector.category,
      severity,
      weightedPoints: Math.round(weightedPoints * 10) / 10,
      reason: result.reason ?? '',
    });
  }

  return {
    wasteScore: Math.max(0, Math.min(100, Math.round(wasteScore))),
    components,
    results,
    structure,
  };
}
