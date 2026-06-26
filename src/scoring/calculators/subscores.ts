import type { Subscores, WasteCategory } from '@tokentama/shared-types';
import type { DetectorResult, StructureSignal } from '../heuristics/types';
import { clampScore } from '../text/similarity';

/** Derive the five efficiency subscores (design doc §10.3) from detector output. */
export function computeSubscores(
  results: Record<WasteCategory, DetectorResult>,
  structure: StructureSignal,
  input: { adoptedPreviousTip?: boolean; hadPreviousTip?: boolean },
): Subscores {
  const sev = (c: WasteCategory): number => results[c]?.severity ?? 0;

  const promptQuality = clampScore(40 + 60 * structure.structureScore - 50 * sev('vagueness'));
  const contextEfficiency = clampScore(100 - 100 * sev('redundantContext'));
  const toolEfficiency = clampScore(100 - 100 * sev('toolOveruse'));
  const outputEfficiency = clampScore(100 - 100 * sev('verbosityMismatch'));

  const learnBase =
    input.adoptedPreviousTip === true ? 100 : input.adoptedPreviousTip === false ? 45 : 75;
  const learningAdoption = clampScore(learnBase - 30 * sev('retryLoop'));

  return { promptQuality, contextEfficiency, toolEfficiency, outputEfficiency, learningAdoption };
}
