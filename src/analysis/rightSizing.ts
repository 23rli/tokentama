import type { ModelInfo } from '@tokentama/shared-types';
import type { Difficulty } from './taskDifficulty';

/**
 * Right-sizing recommendations. Both are DOWN-route only and advisory: Tokentama
 * never switches your model or effort — it points out when a lighter option would
 * very likely do, and always tells you to escalate if the result falls short.
 */
export interface RightSizeRec {
  recommend: boolean;
  message: string;
}

const PREMIUM = new Set(['powerful', 'premium', 'high']);
function isPremiumModel(model: ModelInfo): boolean {
  return (
    PREMIUM.has((model.category ?? '').toLowerCase()) ||
    PREMIUM.has((model.priceCategory ?? '').toLowerCase())
  );
}

/** Suggest a lighter model for trivial/moderate tasks currently on a premium model. */
export function modelRightSizing(difficulty: Difficulty, model: ModelInfo): RightSizeRec {
  if (difficulty === 'complex' || !isPremiumModel(model)) {
    return { recommend: false, message: '' };
  }
  const name = model.name ?? model.family;
  return {
    recommend: true,
    message: `This looks like a ${difficulty} task on ${name} (a premium model). A lighter model would likely handle it for less — switch down and escalate only if the result falls short.`,
  };
}

const EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const HIGH_EFFORTS = new Set(['high', 'xhigh', 'max']);

function pickLowerEffort(supported: string[] | undefined, current: string): string | undefined {
  const ci = EFFORT_ORDER.indexOf(current);
  if (ci < 0) return undefined;
  const lowers = (supported ?? [])
    .map((e) => e.toLowerCase())
    .filter((e) => EFFORT_ORDER.includes(e) && EFFORT_ORDER.indexOf(e) < ci);
  if (lowers.includes('medium')) return 'medium';
  if (lowers.includes('low')) return 'low';
  return lowers.sort((a, b) => EFFORT_ORDER.indexOf(b) - EFFORT_ORDER.indexOf(a))[0];
}

/** Suggest a lower reasoning effort for a trivial task currently at high effort. */
export function effortRightSizing(difficulty: Difficulty, model: ModelInfo): RightSizeRec {
  const effort = (model.reasoningEffort ?? '').toLowerCase();
  if (difficulty !== 'trivial' || !HIGH_EFFORTS.has(effort)) {
    return { recommend: false, message: '' };
  }
  const lower = pickLowerEffort(model.reasoningEfforts, effort);
  const suggestion = lower ? `'${lower}'` : 'a lower';
  return {
    recommend: true,
    message: `Trivial task at '${effort}' thinking effort — ${suggestion} effort would spend far fewer reasoning tokens for the same result.`,
  };
}
