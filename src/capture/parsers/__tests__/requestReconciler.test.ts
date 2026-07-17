import { describe, expect, it } from 'vitest';
import type { ParsedChatRequest, ParsedTurn } from '../types';
import { isAutomaticContinuePrompt, reconcileSessionRequests } from '../requestReconciler';

function request(
  turnIndex: number,
  promptText: string,
  timestamp: string,
): ParsedChatRequest {
  return { turnIndex, promptText, timestamp, completed: true };
}

function turn(promptText: string, startTime: string): ParsedTurn {
  return { turnIndex: 0, promptText, startTime, responseText: '', toolCalls: [] };
}

describe('reconcileSessionRequests', () => {
  it('matches source requests to transcript turns by prompt then timestamp', () => {
    const requests = [
      request(0, 'first omitted', '2026-07-16T10:00:00.000Z'),
      request(1, 'second', '2026-07-16T10:01:00.000Z'),
      request(2, 'rendered differently', '2026-07-16T10:02:00.000Z'),
    ];
    const turns = [
      turn('second', '2026-07-16T10:01:01.000Z'),
      turn('different wrapper text', '2026-07-16T10:02:01.000Z'),
    ];
    const result = reconcileSessionRequests(requests, turns, {
      nowMs: Date.parse('2026-07-16T10:03:00.000Z'),
      sourceModifiedMs: Date.parse('2026-07-16T10:03:00.000Z'),
    });
    expect(result.requests[0].turn).toBeUndefined();
    expect(result.requests[1].turn).toBe(turns[0]);
    expect(result.requests[2].turn).toBe(turns[1]);
    expect(result.ignoredTranscriptTurns).toBe(0);
  });

  it('keeps only the newest recent transcript-only request as pending', () => {
    const requests = [request(0, 'metered', '2026-07-16T10:00:00.000Z')];
    const turns = [
      turn('metered', '2026-07-16T10:00:01.000Z'),
      turn('old transcript artifact', '2026-07-16T10:01:00.000Z'),
      turn('new current request', '2026-07-16T10:04:00.000Z'),
    ];
    const result = reconcileSessionRequests(requests, turns, {
      nowMs: Date.parse('2026-07-16T10:05:00.000Z'),
      sourceModifiedMs: Date.parse('2026-07-16T10:05:00.000Z'),
    });
    expect(result.pendingTurn).toBe(turns[2]);
    expect(result.ignoredTranscriptTurns).toBe(1);
  });

  it('does not keep stale or automatic continuation controls pending', () => {
    const requests = [request(0, 'metered', '2026-07-16T10:00:00.000Z')];
    const continued = reconcileSessionRequests(
      requests,
      [
        turn('metered', '2026-07-16T10:00:00.500Z'),
        turn('Continue: "Continue to iterate?"', '2026-07-16T10:04:00.000Z'),
      ],
      {
        nowMs: Date.parse('2026-07-16T10:05:00.000Z'),
        sourceModifiedMs: Date.parse('2026-07-16T10:05:00.000Z'),
      },
    );
    expect(continued.pendingTurn).toBeUndefined();
    expect(continued.ignoredTranscriptTurns).toBe(1);

    const stale = reconcileSessionRequests(
      requests,
      [
        turn('metered', '2026-07-16T10:00:00.500Z'),
        turn('old request', '2026-07-16T10:01:00.000Z'),
      ],
      {
        nowMs: Date.parse('2026-07-16T11:00:00.000Z'),
        sourceModifiedMs: Date.parse('2026-07-16T10:01:10.000Z'),
      },
    );
    expect(stale.pendingTurn).toBeUndefined();
  });
});

describe('isAutomaticContinuePrompt', () => {
  it('recognizes only the generated continue control phrase', () => {
    expect(isAutomaticContinuePrompt('Continue: "Continue to iterate?"')).toBe(true);
    expect(isAutomaticContinuePrompt('continue')).toBe(false);
    expect(isAutomaticContinuePrompt('Continue implementing the feature')).toBe(false);
  });
});
