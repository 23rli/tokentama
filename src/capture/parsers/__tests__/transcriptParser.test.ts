import { describe, it, expect } from 'vitest';
import { parseTranscript } from '../transcriptParser';

const line = (obj: unknown): string => JSON.stringify(obj);

describe('parseTranscript', () => {
  it('extracts the user prompt, response text, and tool calls per turn', () => {
    const content = [
      line({
        type: 'session.start',
        data: { sessionId: 'sess-1' },
        timestamp: '2026-06-22T01:00:00.000Z',
      }),
      line({
        type: 'user.message',
        data: { content: 'Refactor the parser' },
        timestamp: '2026-06-22T01:00:00.500Z',
      }),
      line({
        type: 'assistant.turn_start',
        data: { turnId: '0' },
        timestamp: '2026-06-22T01:00:01.000Z',
      }),
      line({
        type: 'assistant.message',
        data: {
          content: 'Hello',
          toolRequests: [{
            toolCallId: 't1',
            name: 'read_file',
            type: 'function',
            arguments: JSON.stringify({ filePath: '.github/skills/fde-hq/SKILL.md' }),
          }],
        },
        timestamp: '2026-06-22T01:00:02.000Z',
      }),
      line({
        type: 'tool.execution_start',
        data: {
          toolCallId: 't1',
          toolName: 'read_file',
          arguments: { filePath: '.github/skills/fde-hq/SKILL.md' },
        },
        timestamp: '2026-06-22T01:00:02.500Z',
      }),
      line({
        type: 'tool.execution_complete',
        data: { toolCallId: 't1', success: true },
        timestamp: '2026-06-22T01:00:03.000Z',
      }),
      line({
        type: 'assistant.message',
        data: { content: 'World' },
        timestamp: '2026-06-22T01:00:04.000Z',
      }),
      line({
        type: 'assistant.turn_end',
        data: { turnId: '0' },
        timestamp: '2026-06-22T01:00:05.000Z',
      }),
    ].join('\n');

    const parsed = parseTranscript(content);
    expect(parsed.sessionId).toBe('sess-1');
    expect(parsed.startTime).toBe('2026-06-22T01:00:00.000Z');
    expect(parsed.turns).toHaveLength(1);
    const turn = parsed.turns[0]!;
    expect(turn.promptText).toBe('Refactor the parser');
    expect(turn.responseText).toContain('Hello');
    expect(turn.responseText).toContain('World');
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0]!.toolName).toBe('read_file');
    expect(turn.toolCalls[0]!.success).toBe(true);
    expect(turn.toolCalls[0]!.durationMs).toBe(500);
    expect(turn.toolCalls[0]!.toolKind).toBe('local');
    expect(turn.toolCalls[0]!.loadedSkills).toEqual(['fde-hq']);
  });

  it('separates turns by user message and ignores malformed lines', () => {
    const content = [
      line({ type: 'user.message', data: { content: 'first' } }),
      line({ type: 'assistant.message', data: { content: 'a' } }),
      'this is not json',
      line({ type: 'user.message', data: { content: 'second' } }),
      line({ type: 'assistant.message', data: { content: 'b' } }),
    ].join('\n');

    const parsed = parseTranscript(content);
    expect(parsed.turns).toHaveLength(2);
    expect(parsed.turns[0]!.promptText).toBe('first');
    expect(parsed.turns[1]!.promptText).toBe('second');
    expect(parsed.turns[1]!.responseText).toBe('b');
  });
});
