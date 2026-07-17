import { createHash } from 'node:crypto';
import type { UsageObservation } from '@tokentama/shared-types';

export type UsageObservationDraft = Omit<UsageObservation, 'observationId'>;

/** Canonical JSON with recursively sorted object keys and no undefined values. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function stableHash(...parts: string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(part);
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * Finalize a content-free observation. observedAt is intentionally excluded
 * from identity so rescanning an unchanged source record is idempotent.
 */
export function finalizeUsageObservation(draft: UsageObservationDraft): UsageObservation {
  const { observedAt: _observedAt, ...identity } = draft;
  return {
    ...draft,
    observationId: stableHash('usage-observation-v1', canonicalJson(identity)),
  };
}

function normalize(value: unknown): unknown {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value !== 'object') return String(value);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) result[key] = normalize(child);
  }
  return result;
}