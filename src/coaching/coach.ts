import type { TipRequest, TipResponse } from '@tokentama/shared-types';
import { loadCoachConfig, isCoachConfigured, type CoachConfig } from './config';
import { heuristicGenerateTip } from './heuristicCoach';
import { llmGenerateTip } from './llmCoach';

/**
 * Generate a coaching tip. Uses a live LLM when configured, and always falls
 * back to the deterministic heuristic coach on missing config or any error —
 * so coaching never breaks the demo.
 */
export async function generateTip(
  req: TipRequest,
  config: CoachConfig = loadCoachConfig(),
): Promise<TipResponse> {
  if (isCoachConfigured(config)) {
    try {
      return await llmGenerateTip(req, config);
    } catch {
      // fall through to heuristic
    }
  }
  return heuristicGenerateTip(req);
}
