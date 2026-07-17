import type { UsageObservation } from '@tokentama/shared-types';
import { USAGE_OBSERVATION_SCHEMA_VERSION } from '@tokentama/shared-types';
import { finalizeUsageObservation } from '../canonical';

export function observation(overrides: Partial<UsageObservation> = {}): UsageObservation {
  return finalizeUsageObservation({
    schemaVersion: USAGE_OBSERVATION_SCHEMA_VERSION,
    sourceRecordId: overrides.sourceRecordId ?? 'record-1',
    occurredAt: overrides.occurredAt ?? '2026-07-15T12:00:00.000Z',
    observedAt: overrides.observedAt ?? '2026-07-15T12:00:01.000Z',
    source: overrides.source ?? {
      adapterId: 'test-adapter',
      applicationId: 'test-app',
      applicationName: 'Test AI',
      providerId: 'test-provider',
      providerName: 'Test Provider',
    },
    project: overrides.project ?? { key: 'project-1', name: 'Project One' },
    sessionKey: overrides.sessionKey ?? 'session-1',
    interaction: overrides.interaction ?? { type: 'chat-turn', index: 0 },
    model: overrides.model ?? { id: 'model-1', name: 'Model One' },
    usage: overrides.usage ?? {
      input: { value: 100, provenance: 'metered' },
      output: { value: 20, provenance: 'metered' },
      knownTotal: 120,
      partial: false,
    },
    charges: overrides.charges ?? [
      { unit: 'copilot-aic', value: 2, provenance: 'provider-metered' },
    ],
    tools: overrides.tools ?? [],
    evidence: overrides.evidence ?? [],
  });
}