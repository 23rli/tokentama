/**
 * The six world states the pet's ecosystem can be in, ordered from
 * healthiest to most degraded. Mapped from the overall efficiency score by the
 * scoring engine. See design doc §9.2 and §21.
 */
export type PetWorldState = 'thriving' | 'healthy' | 'concerned' | 'critical' | 'collapse' | 'dead';

/** Ordered list (best → worst) for UI iteration and transition math. */
export const PET_WORLD_STATES: readonly PetWorldState[] = [
  'thriving',
  'healthy',
  'concerned',
  'critical',
  'collapse',
  'dead',
] as const;
