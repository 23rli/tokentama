import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listCopilotSessions } from '../copilotPaths';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('listCopilotSessions freshness', () => {
  it('includes a late model catalog mtime in the session signature', () => {
    const root = mkdtempSync(join(tmpdir(), 'tokenlens-paths-'));
    dirs.push(root);
    const hash = 'workspace';
    const session = 'session-1';
    const transcriptDir = join(root, hash, 'GitHub.copilot-chat', 'transcripts');
    const chatDir = join(root, hash, 'chatSessions');
    const modelDir = join(root, hash, 'GitHub.copilot-chat', 'debug-logs', session);
    mkdirSync(transcriptDir, { recursive: true });
    mkdirSync(chatDir, { recursive: true });
    mkdirSync(modelDir, { recursive: true });
    const transcript = join(transcriptDir, `${session}.jsonl`);
    const chat = join(chatDir, `${session}.jsonl`);
    const models = join(modelDir, 'models.json');
    writeFileSync(transcript, '{}\n');
    writeFileSync(chat, '{}\n');
    writeFileSync(models, '{}\n');
    const old = new Date('2026-07-16T10:00:00.000Z');
    const fresh = new Date('2026-07-16T10:05:00.000Z');
    utimesSync(transcript, old, old);
    utimesSync(chat, old, old);
    utimesSync(models, fresh, fresh);

    const found = listCopilotSessions(root, hash);
    expect(found).toHaveLength(1);
    expect(found[0].transcriptPath).toBe(transcript);
    expect(found[0].chatSessionPath).toBe(chat);
    expect(found[0].modelsJsonPath).toBe(models);
    expect(found[0].modifiedMs).toBe(fresh.getTime());
  });

  it('discovers a new chatSession before its transcript exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'tokenlens-paths-'));
    dirs.push(root);
    const hash = 'workspace';
    const session = 'new-session';
    const chatDir = join(root, hash, 'chatSessions');
    mkdirSync(chatDir, { recursive: true });
    const chat = join(chatDir, `${session}.jsonl`);
    writeFileSync(chat, '{}\n');
    const modified = new Date('2026-07-19T10:05:00.000Z');
    utimesSync(chat, modified, modified);

    const found = listCopilotSessions(root, hash);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      sessionId: session,
      workspaceHash: hash,
      transcriptPath: undefined,
      chatSessionPath: chat,
      modifiedMs: modified.getTime(),
    });
  });

  it('deduplicates a session found in both source directories', () => {
    const root = mkdtempSync(join(tmpdir(), 'tokenlens-paths-'));
    dirs.push(root);
    const hash = 'workspace';
    const session = 'shared-session';
    const transcriptDir = join(root, hash, 'GitHub.copilot-chat', 'transcripts');
    const chatDir = join(root, hash, 'chatSessions');
    mkdirSync(transcriptDir, { recursive: true });
    mkdirSync(chatDir, { recursive: true });
    writeFileSync(join(transcriptDir, `${session}.jsonl`), '{}\n');
    writeFileSync(join(chatDir, `${session}.jsonl`), '{}\n');

    const found = listCopilotSessions(root, hash);
    expect(found).toHaveLength(1);
    expect(found[0].transcriptPath).toBeDefined();
    expect(found[0].chatSessionPath).toBeDefined();
  });
});
