import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSessionEvents } from '../copilotReader';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readSessionEvents', () => {
  it('surfaces the first prompt from chatSessions before a transcript exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tokenlens-reader-'));
    tempDirs.push(dir);
    const chatSessionPath = join(dir, 'session.jsonl');
    writeFileSync(
      chatSessionPath,
      JSON.stringify({
        kind: 0,
        v: {
          sessionId: 'chat-early',
          requests: [
            {
              requestId: 'request-early',
              timestamp: '2026-07-19T10:00:00.000Z',
              message: { text: 'First prompt' },
            },
          ],
        },
      }),
    );

    const events = readSessionEvents({
      sessionId: 'chat-early',
      workspaceHash: 'hash',
      chatSessionPath,
      modifiedMs: Date.parse('2026-07-19T10:00:00.000Z'),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sessionId: 'chat-early',
      sourceRequestId: 'request-early',
      promptText: 'First prompt',
      timestamp: '2026-07-19T10:00:00.000Z',
      meteringStatus: 'pending',
    });
  });

  it('dates an omitted first user message from session.start, not mutable file mtime', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tokenlens-reader-'));
    tempDirs.push(dir);
    const transcriptPath = join(dir, 'chat.jsonl');
    const chatSessionPath = join(dir, 'session.jsonl');
    const started = '2026-07-01T09:30:00.000Z';

    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: 'session.start',
          data: { sessionId: 'chat-1' },
          timestamp: started,
        }),
        JSON.stringify({
          type: 'assistant.message',
          data: { content: 'Response to the omitted first prompt' },
          timestamp: '2026-07-01T09:30:01.000Z',
        }),
      ].join('\n'),
    );
    writeFileSync(
      chatSessionPath,
      JSON.stringify({
        kind: 0,
        v: {
          sessionId: 'chat-1',
          requests: [
            {
              message: { text: 'First prompt' },
              promptTokens: 1234,
              completionTokens: 100,
              copilotCredits: 2.5,
            },
          ],
        },
      }),
    );

    const events = readSessionEvents({
      sessionId: 'chat-1',
      workspaceHash: 'hash',
      transcriptPath,
      chatSessionPath,
      // Simulate reopening the old chat much later.
      modifiedMs: Date.parse('2026-07-10T15:00:00.000Z'),
    });

    expect(events).toHaveLength(1);
    expect(events[0].promptText).toBe('First prompt');
    expect(events[0].responseText).toBe('Response to the omitted first prompt');
    expect(events[0].timestamp).toBe(started);
    expect(events[0].tokens?.inputTokens).toBe(1234);
    expect(events[0].tokens?.estimated).toBe(false);
  });
});
