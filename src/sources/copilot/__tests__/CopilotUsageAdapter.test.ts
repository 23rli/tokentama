import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CopilotUsageAdapter, copilotSourceRecordId } from '../CopilotUsageAdapter';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('CopilotUsageAdapter', () => {
  it('projects deterministic content-free observations with metering and workflow evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tokenlens-adapter-'));
    tempDirs.push(root);
    const hash = 'workspace-hash';
    const dir = join(root, hash);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'workspace.json'), JSON.stringify({
      folder: 'file:///C:/Secret/Customer/ledger-project',
    }));
    const transcriptPath = join(root, 'transcript.jsonl');
    const chatSessionPath = join(root, 'chat.jsonl');
    writeFileSync(transcriptPath, [
      JSON.stringify({
        type: 'session.start',
        data: { sessionId: 'secret-session-id' },
        timestamp: '2026-07-16T10:00:00.000Z',
      }),
      JSON.stringify({
        type: 'user.message',
        data: { content: '@fde-tpm customer salary secret' },
        timestamp: '2026-07-16T10:00:01.000Z',
      }),
      JSON.stringify({
        type: 'tool.execution_start',
        data: {
          toolCallId: 'tool-1',
          toolName: 'mcp_workiq_ask_work_iq',
          arguments: { query: 'private customer content' },
        },
        timestamp: '2026-07-16T10:00:02.000Z',
      }),
      JSON.stringify({
        type: 'tool.execution_complete',
        data: { toolCallId: 'tool-1', success: true },
        timestamp: '2026-07-16T10:00:03.000Z',
      }),
    ].join('\n'));
    writeFileSync(chatSessionPath, JSON.stringify({
      kind: 0,
      v: {
        sessionId: 'secret-session-id',
        requests: [{
          message: { text: '@fde-tpm customer salary secret' },
          promptTokens: 1_000,
          completionTokens: 100,
          copilotCredits: 3,
        }],
      },
    }));

    const adapter = new CopilotUsageAdapter(root);
    const scan = await adapter.scan([{
      sessionId: 'secret-session-id',
      workspaceHash: hash,
      transcriptPath,
      chatSessionPath,
      modifiedMs: 1,
    }]);
    expect(scan.health.status).toBe('ready');
    expect(scan.health.capabilities.perToolTokens).toBe(false);
    expect(scan.observations).toHaveLength(1);
    const row = scan.observations[0];
    expect(row.project.name).toBe('ledger-project');
    expect(row.usage).toMatchObject({ knownTotal: 1_100, partial: false });
    expect(row.charges).toEqual([
      { unit: 'copilot-aic', value: 3, provenance: 'provider-metered' },
    ]);
    expect(row.evidence).toContainEqual({ kind: 'agent', value: 'fde-tpm', confidence: 'high' });
    expect(row.tools[0]).toMatchObject({ name: 'mcp_workiq_ask_work_iq', kind: 'mcp' });

    const serialized = JSON.stringify(row);
    for (const forbidden of [
      'customer salary secret',
      'private customer content',
      'Secret/Customer',
      'secret-session-id',
      'promptText',
      'responseText',
      'arguments',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    const rescanned = await adapter.scan([{
      sessionId: 'secret-session-id',
      workspaceHash: hash,
      transcriptPath,
      chatSessionPath,
      modifiedMs: 2,
    }]);
    expect(rescanned.observations[0].observationId).toBe(row.observationId);
    expect(rescanned.observations[0].sourceRecordId).toBe(row.sourceRecordId);
  });

  it('keeps logical identity stable when Copilot renumbers a turn', () => {
    const session = { workspaceHash: 'hash', sessionId: 'session' };
    const first = copilotSourceRecordId({
      sourceRequestId: 'request-123',
      timestamp: '2026-07-16T10:00:00.000Z',
      turnIndex: 4,
    }, session);
    const reindexed = copilotSourceRecordId({
      sourceRequestId: 'request-123',
      timestamp: '2026-07-16T10:00:00.000Z',
      turnIndex: 1,
    }, session);
    expect(reindexed).toBe(first);
  });

  it('uses a content-free timestamp fallback when requestId is absent', () => {
    const session = { workspaceHash: 'hash', sessionId: 'session' };
    const first = copilotSourceRecordId({
      timestamp: '2026-07-16T10:00:00.000Z',
      turnIndex: 9,
    }, session);
    const reindexed = copilotSourceRecordId({
      timestamp: '2026-07-16T10:00:00.000Z',
      turnIndex: 2,
    }, session);
    const later = copilotSourceRecordId({
      timestamp: '2026-07-16T10:00:01.000Z',
      turnIndex: 3,
    }, session);
    expect(reindexed).toBe(first);
    expect(later).not.toBe(first);
  });
});