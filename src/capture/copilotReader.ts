import { readFileSync } from 'node:fs';
import type { PromptEvent } from '@ecoprompt/shared-types';
import { parseTranscript } from './parsers/transcriptParser';
import { parseChatSessionTokens } from './parsers/chatSessionTokens';
import { buildPromptEvent } from './parsers/promptEventFactory';
import type { CopilotSessionPaths } from './copilotPaths';

function safeRead(path: string | undefined): string {
  if (!path) return '';
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Read one Copilot session and produce one PromptEvent per user turn: the user
 * prompt + aggregated response + tool calls (from the append-only transcript),
 * enriched with REAL metered token + credit counts (from `chatSessions`, when
 * present). Turn N in the transcript aligns with request N in the chatSession;
 * when real counts are missing the event factory falls back to estimates.
 */
export function readSessionEvents(paths: CopilotSessionPaths, userId = 'local-user'): PromptEvent[] {
  const parsed = parseTranscript(safeRead(paths.transcriptPath));
  const tokensByTurn = parseChatSessionTokens(safeRead(paths.chatSessionPath));
  const sessionId = parsed.sessionId || paths.sessionId;

  const events: PromptEvent[] = [];
  const promptTurns = parsed.turns.filter((t) => (t.promptText ?? '').trim().length > 0);
  promptTurns.forEach((turn, index) => {
    // Re-index by user-prompt order (0,1,2,…) so turn N aligns with chatSession
    // request N, regardless of any non-prompt turns in the transcript stream.
    const real = tokensByTurn.get(index);
    events.push(
      buildPromptEvent({
        source: 'transcript',
        sessionId,
        userId,
        turnIndex: index,
        promptText: turn.promptText ?? '',
        responseText: turn.responseText || undefined,
        toolCalls: turn.toolCalls,
        timestamp: turn.startTime,
        inputTokensOverride: real?.promptTokens,
        outputTokensOverride: real?.completionTokens,
        copilotCredits: real?.copilotCredits,
      }),
    );
  });
  return events;
}
