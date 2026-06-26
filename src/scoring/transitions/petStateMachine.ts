import type { PetWorldState } from '@tokentama/shared-types';
import { PET_WORLD_STATES } from '@tokentama/shared-types';

/** Map an overall efficiency score (0..100) to a world state (design doc §9.2). */
export function scoreToState(score: number): PetWorldState {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  if (s === 0) return 'dead';
  if (s <= 19) return 'collapse';
  if (s <= 39) return 'critical';
  if (s <= 59) return 'concerned';
  if (s <= 79) return 'healthy';
  return 'thriving';
}

/** Rank in PET_WORLD_STATES (0 = healthiest, 5 = dead). */
export function stateRank(state: PetWorldState): number {
  return PET_WORLD_STATES.indexOf(state);
}

export interface StateTransition {
  state: PetWorldState;
  previousState: PetWorldState | null;
  delta: number;
  direction: 'up' | 'down' | 'none';
  /** True if the world moved to a healthier state. */
  recovered: boolean;
}

export function transition(previousScore: number | null, newScore: number): StateTransition {
  const state = scoreToState(newScore);
  const previousState = previousScore == null ? null : scoreToState(previousScore);
  const delta = previousScore == null ? 0 : Math.round(newScore - previousScore);
  const direction: StateTransition['direction'] = delta > 0 ? 'up' : delta < 0 ? 'down' : 'none';
  const recovered = previousState != null && stateRank(state) < stateRank(previousState);
  return { state, previousState, delta, direction, recovered };
}
