import { readFileSync } from 'node:fs';
import type { PromptEvent } from '@ecoprompt/shared-types';
import { parseTranscript } from './parsers/transcriptParser';
import { parseChatSessionTokens } from './parsers/chatSessionTokens';
import { parseChatSession } from './parsers/chatSessionParser';
import { parseModelCatalog, resolveModel } from './parsers/modelCatalog';
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
 * enriched with REAL metered token + credit counts and the selected model's
 * pricing/capabilities (from `chatSessions` + `models.json`).
 */
export function readSessionEvents(paths: CopilotSessionPaths, userId = 'local-user'): PromptEvent[] {
  const chatContent = safeRead(paths.chatSessionPath);
  const parsed = parseTranscript(safeRead(paths.transcriptPath));
  const tokensByTurn = parseChatSessionTokens(chatContent);
  const catalog = parseModelCatalog(safeRead(paths.modelsJsonPath));
  const model = resolveModel(parseChatSession(chatContent).model, catalog);
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
        model,
        inputTokensOverride: real?.promptTokens,
        outputTokensOverride: real?.completionTokens,
        copilotCredits: real?.copilotCredits,
      }),
    );
  });
  return events;
}
