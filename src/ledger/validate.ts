import type {
  NativeCharge,
  UsageAttributionEvidence,
  UsageObservation,
  UsageQuantity,
  UsageToolObservation,
} from '@tokentama/shared-types';
import { finalizeUsageObservation } from './canonical';

export function isUsageObservation(value: unknown): value is UsageObservation {
  if (!isObject(value)) return false;
  const row = value as unknown as UsageObservation;
  if (
    row.schemaVersion !== 1 ||
    !nonEmptyString(row.observationId) ||
    !nonEmptyString(row.sourceRecordId) ||
    !isoTimestamp(row.occurredAt) ||
    !isoTimestamp(row.observedAt) ||
    !isObject(row.source) ||
    !nonEmptyString(row.source.adapterId) ||
    !nonEmptyString(row.source.applicationId) ||
    !nonEmptyString(row.source.applicationName) ||
    !nonEmptyString(row.source.providerId) ||
    !nonEmptyString(row.source.providerName) ||
    !isObject(row.project) ||
    !nonEmptyString(row.project.key) ||
    (row.project.name != null && typeof row.project.name !== 'string') ||
    !nonEmptyString(row.sessionKey) ||
    !isObject(row.interaction) ||
    !['chat-turn', 'completion', 'agent-run', 'unknown'].includes(row.interaction.type) ||
    (row.interaction.index != null && !nonNegativeInteger(row.interaction.index)) ||
    (row.model != null && !validModel(row.model)) ||
    !isObject(row.usage) ||
    (row.usage.status != null && !['metered', 'input-only', 'output-only', 'pending', 'unavailable'].includes(row.usage.status)) ||
    !validQuantity(row.usage.input) ||
    !validQuantity(row.usage.output) ||
    !nonNegativeFinite(row.usage.knownTotal) ||
    typeof row.usage.partial !== 'boolean' ||
    (row.usage.breakdown != null && !validBreakdown(row.usage.breakdown)) ||
    !Array.isArray(row.charges) ||
    !row.charges.every(validCharge) ||
    !Array.isArray(row.tools) ||
    !row.tools.every(validTool) ||
    !Array.isArray(row.evidence) ||
    !row.evidence.every(validEvidence)
  ) {
    return false;
  }
  const { observationId: _observationId, ...draft } = row;
  return finalizeUsageObservation(draft).observationId === row.observationId;
}

function validQuantity(value: unknown): value is UsageQuantity {
  if (!isObject(value)) return false;
  const quantity = value as unknown as UsageQuantity;
  return (
    nonNegativeFinite(quantity.value) &&
    ['metered', 'estimated', 'unknown'].includes(quantity.provenance)
  );
}

function validCharge(value: unknown): value is NativeCharge {
  if (!isObject(value)) return false;
  const charge = value as unknown as NativeCharge;
  return (
    nonEmptyString(charge.unit) &&
    nonNegativeFinite(charge.value) &&
    ['provider-metered', 'estimated', 'unknown'].includes(charge.provenance)
  );
}

function validTool(value: unknown): value is UsageToolObservation {
  if (!isObject(value)) return false;
  const tool = value as unknown as UsageToolObservation;
  return (
    nonEmptyString(tool.callKey) &&
    nonEmptyString(tool.name) &&
    ['mcp', 'local', 'unknown'].includes(tool.kind) &&
    (tool.success == null || typeof tool.success === 'boolean') &&
    (tool.durationMs == null || nonNegativeFinite(tool.durationMs))
  );
}

function validEvidence(value: unknown): value is UsageAttributionEvidence {
  if (!isObject(value)) return false;
  const evidence = value as unknown as UsageAttributionEvidence;
  return (
    ['skill', 'agent', 'prompt', 'tool'].includes(evidence.kind) &&
    nonEmptyString(evidence.value) &&
    ['high', 'medium'].includes(evidence.confidence)
  );
}

function validBreakdown(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) =>
    isObject(item) &&
    typeof item.category === 'string' &&
    typeof item.label === 'string' &&
    nonNegativeFinite(item.tokens) &&
    ['metered', 'estimated', 'unknown'].includes(item.provenance as string),
  );
}

function validModel(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    nonEmptyString(value.id) &&
    (value.name == null || typeof value.name === 'string') &&
    (value.providerId == null || typeof value.providerId === 'string') &&
    (value.providerName == null || typeof value.providerName === 'string') &&
    (value.reasoningEffort == null || typeof value.reasoningEffort === 'string')
  );
}

function isoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}