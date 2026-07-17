import { readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  PromptEvent,
  UsageAttributionEvidence,
  UsageObservation,
  UsageProvenance,
  UsageSourceHealth,
  UsageToolObservation,
} from '@tokentama/shared-types';
import { USAGE_OBSERVATION_SCHEMA_VERSION } from '@tokentama/shared-types';
import type { CopilotSessionPaths } from '../../capture/copilotPaths';
import { readSessionEvents } from '../../capture/copilotReader';
import { finalizeUsageObservation, stableHash } from '../../ledger/canonical';
import type { SourceAdapter, SourceAdapterCapabilities, SourceScanResult } from '../types';

export const COPILOT_ADAPTER_ID = 'vscode-github-copilot-chat';

/** Projects Copilot's private source format into the public content-free ledger contract. */
export class CopilotUsageAdapter implements SourceAdapter<readonly CopilotSessionPaths[]> {
  readonly id = COPILOT_ADAPTER_ID;
  readonly applicationId = 'github-copilot-chat';
  readonly applicationName = 'GitHub Copilot Chat';
  readonly capabilities: SourceAdapterCapabilities = {
    tokens: true,
    nativeCharges: true,
    tools: true,
    perToolTokens: false,
  };

  constructor(private readonly workspaceStorageRoot: string) {}

  async scan(sessions: readonly CopilotSessionPaths[]): Promise<SourceScanResult> {
    const observedAt = new Date().toISOString();
    const observations: UsageObservation[] = [];
    let readErrors = 0;
    for (const session of sessions) {
      try {
        const project = this.resolveProject(session.workspaceHash);
        for (const event of readSessionEvents(session)) {
          // A transcript-only pending row has no stable provider request ID and
          // is transient Live state, not durable usage.
          if (event.meteringStatus === 'pending' && !event.sourceRequestId) continue;
          observations.push(this.projectEvent(event, session, project, observedAt));
        }
      } catch {
        readErrors += 1;
      }
    }
    const status: UsageSourceHealth['status'] =
      readErrors > 0 ? 'error' : sessions.length > 0 ? 'ready' : 'empty';
    return {
      observations,
      health: {
        adapterId: this.id,
        applicationName: this.applicationName,
        status,
        lastScanAt: observedAt,
        sessionCount: sessions.length,
        detail:
          readErrors > 0
            ? `${readErrors} session${readErrors === 1 ? '' : 's'} could not be read.`
            : sessions.length > 0
              ? 'Local Copilot chat storage scanned.'
              : 'No in-scope Copilot transcripts found yet.',
        capabilities: this.capabilities,
      },
    };
  }

  private projectEvent(
    event: PromptEvent,
    session: CopilotSessionPaths,
    project: UsageObservation['project'],
    observedAt: string,
  ): UsageObservation {
    const sourceRecordId = copilotSourceRecordId(event, session);
    const input = quantity(event.tokens?.inputTokens, inputProvenance(event));
    const output = quantity(event.tokens?.outputTokens, outputProvenance(event));
    const anyMetered = input.provenance === 'metered' || output.provenance === 'metered';
    const fullyMetered = input.provenance === 'metered' && output.provenance === 'metered';
    const tools = projectTools(event, sourceRecordId);
    const evidence = projectEvidence(event, tools);
    const credits = event.tokens?.copilotCredits;
    const estimatedCredits = event.tokens?.estimatedCredits;

    return finalizeUsageObservation({
      schemaVersion: USAGE_OBSERVATION_SCHEMA_VERSION,
      sourceRecordId,
      occurredAt: validIso(event.timestamp),
      observedAt,
      source: {
        adapterId: this.id,
        applicationId: this.applicationId,
        applicationName: this.applicationName,
        providerId: 'github',
        providerName: 'GitHub',
      },
      project,
      sessionKey: stableHash('copilot-session-v1', session.workspaceHash, session.sessionId),
      interaction: { type: 'chat-turn', index: event.turnIndex },
      model: event.model
        ? {
            id: event.model.id,
            name: event.model.name,
            providerId: event.model.vendor?.toLowerCase(),
            providerName: event.model.vendor,
            reasoningEffort: event.model.reasoningEffort,
          }
        : undefined,
      usage: {
        status: event.meteringStatus,
        input,
        output,
        knownTotal: meteredValue(input) + meteredValue(output),
        partial: anyMetered && !fullyMetered,
        breakdown:
          input.provenance === 'metered'
            ? event.tokens?.contextBreakdown?.map((item) => ({
                category: item.category,
                label: item.label,
                tokens: safeNumber(item.tokens),
                provenance: 'metered' as const,
              }))
            : undefined,
      },
      charges:
        isNonNegativeNumber(credits)
          ? [{ unit: 'copilot-aic', value: credits, provenance: 'provider-metered' }]
          : isNonNegativeNumber(estimatedCredits)
            ? [{ unit: 'copilot-aic', value: estimatedCredits, provenance: 'estimated' }]
            : [],
      tools,
      evidence,
    });
  }

  private resolveProject(workspaceHash: string): UsageObservation['project'] {
    const key = stableHash('copilot-project-v1', workspaceHash);
    let name: string | undefined;
    try {
      const raw = readFileSync(join(this.workspaceStorageRoot, workspaceHash, 'workspace.json'), 'utf8');
      const parsed = JSON.parse(raw) as { folder?: string; workspace?: string };
      name = projectNameFromUri(parsed.workspace ?? parsed.folder);
    } catch {
      /* Pseudonymous fallback below. */
    }
    return { key, name: name ?? `Project ${key.slice(0, 8)}` };
  }
}

function projectTools(event: PromptEvent, sourceRecordId: string): UsageToolObservation[] {
  return (event.toolCalls ?? []).map((tool, index) => ({
    callKey: stableHash(
      'tool-call-v1',
      sourceRecordId,
      tool.toolCallId ?? `${tool.toolName}:${index}`,
    ),
    name: tool.toolName,
    kind: tool.toolKind ?? 'unknown',
    success: tool.success,
    durationMs: isNonNegativeNumber(tool.durationMs) ? tool.durationMs : undefined,
  }));
}

function projectEvidence(
  event: PromptEvent,
  tools: UsageToolObservation[],
): UsageAttributionEvidence[] {
  const evidence = new Map<string, UsageAttributionEvidence>();
  const add = (item: UsageAttributionEvidence): void => {
    evidence.set(`${item.kind}:${item.value}`, item);
  };
  for (const skill of new Set((event.toolCalls ?? []).flatMap((tool) => tool.loadedSkills ?? []))) {
    add({ kind: 'skill', value: skill, confidence: 'high' });
  }
  const explicit = explicitWorkflow(event.promptText);
  if (explicit) add(explicit);
  for (const tool of tools) {
    if (tool.kind === 'mcp') add({ kind: 'tool', value: tool.name, confidence: 'medium' });
  }
  return [...evidence.values()].sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value),
  );
}

function explicitWorkflow(promptText: string): UsageAttributionEvidence | undefined {
  const text = promptText.trim();
  const savedPrompt = text.match(/^\/prompt\s+([\w.-]+)/i);
  if (savedPrompt?.[1]) return { kind: 'prompt', value: savedPrompt[1], confidence: 'high' };
  const slash = text.match(/^\/([\w.-]+)/);
  if (slash?.[1]) return { kind: 'skill', value: slash[1], confidence: 'high' };
  const agent = text.match(/^@([\w.-]+)/);
  if (agent?.[1]) return { kind: 'agent', value: agent[1], confidence: 'high' };
  return undefined;
}

function inputProvenance(event: PromptEvent): UsageProvenance {
  if (!event.tokens) return 'unknown';
  const estimated = event.tokens.inputEstimated ?? event.tokens.estimated;
  return estimated ? 'estimated' : 'metered';
}

function outputProvenance(event: PromptEvent): UsageProvenance {
  if (!event.tokens) return 'unknown';
  const estimated = event.tokens.outputEstimated ?? event.tokens.estimated;
  return estimated ? 'estimated' : 'metered';
}

function quantity(value: number | undefined, provenance: UsageProvenance) {
  return { value: safeNumber(value), provenance };
}

function meteredValue(quantityValue: { value: number; provenance: UsageProvenance }): number {
  return quantityValue.provenance === 'metered' ? quantityValue.value : 0;
}

function projectNameFromUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  let path = uri;
  try {
    path = uri.startsWith('file:') ? fileURLToPath(uri) : decodeURIComponent(uri);
  } catch {
    path = decodeURIComponent(uri.replace(/^file:\/\/+/, ''));
  }
  const file = basename(path.replace(/[\\/]+$/, ''));
  if (!file) return undefined;
  return extname(file).toLowerCase() === '.code-workspace'
    ? file.slice(0, -'.code-workspace'.length)
    : file;
}

function validIso(value: string): string {
  return Number.isNaN(Date.parse(value)) ? new Date(0).toISOString() : new Date(value).toISOString();
}

function safeNumber(value: number | undefined): number {
  return isNonNegativeNumber(value) ? value : 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Stable across Copilot turn-index renumbering and compaction. */
export function copilotSourceRecordId(
  event: Pick<PromptEvent, 'sourceRequestId' | 'timestamp' | 'turnIndex' | 'model'>,
  session: Pick<CopilotSessionPaths, 'workspaceHash' | 'sessionId'>,
): string {
  if (event.sourceRequestId) {
    return stableHash(
      'copilot-source-record-v2',
      session.workspaceHash,
      session.sessionId,
      'request-id',
      event.sourceRequestId,
    );
  }
  const timestamp = validIso(event.timestamp);
  if (timestamp !== new Date(0).toISOString()) {
    return stableHash(
      'copilot-source-record-v2',
      session.workspaceHash,
      session.sessionId,
      'timestamp',
      timestamp,
      event.model?.id ?? 'unknown-model',
    );
  }
  return stableHash(
    'copilot-source-record-v2',
    session.workspaceHash,
    session.sessionId,
    'legacy-index-fallback',
    String(event.turnIndex),
    event.model?.id ?? 'unknown-model',
  );
}