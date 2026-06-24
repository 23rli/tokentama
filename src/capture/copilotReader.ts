import { readFileSync } from 'node:fs';
import type { PromptEvent } from '@ecoprompt/shared-types';
import { parseTranscript } from './parsers/transcriptParser';
import { parseChatSessionTokens } from './parsers/chatSessionTokens';
import { parseChatSession, parseEarlyPrompts } from './parsers/chatSessionParser';
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
 * Read one Copilot session into one PromptEvent per user turn.
 *
 * The transcript is append-only and reliable for the user's prompts EXCEPT the
 * very first one of a session, which Copilot does NOT write as a `user.message`
 * (the transcript opens with the assistant's response to it). That first prompt
 * lives only in `chatSessions`. So we reconcile by count: the transcript's
 * user-message turns map to the most-recent requests, and any earlier requests
 * missing from the transcript are backfilled from the chatSession. Tokens +
 * model pricing come from `chatSessions` / `models.json`, aligned by request index.
 */
export function readSessionEvents(paths: CopilotSessionPaths, userId = 'local-user'): PromptEvent[] {
  const chatContent = safeRead(paths.chatSessionPath);
  const parsed = parseTranscript(safeRead(paths.transcriptPath));
  const tokensByTurn = parseChatSessionTokens(chatContent);
  const chatSession = parseChatSession(chatContent);
  const catalog = parseModelCatalog(safeRead(paths.modelsJsonPath));
  const model = resolveModel(chatSession.model, catalog);
  const sessionId = parsed.sessionId || paths.sessionId;

  // Prompt text the chatSession recorded per request (reliable for the first /
  // recent requests; the transcript covers the rest).
  const promptByRequest = new Map<number, string>();
  for (const r of chatSession.requests) {
    const text = r.promptText.trim();
    if (text) promptByRequest.set(r.turnIndex, text);
  }
  // The kind:0 snapshot reliably holds the session's FIRST prompt(s), which the
  // transcript omits and the patched reconstruction overwrites.
  const earlyPrompts = parseEarlyPrompts(chatContent);

  // Transcript turns that carry a real user prompt (a `user.message`), in order.
  const transcriptTurns = parsed.turns.filter((t) => (t.promptText ?? '').trim().length > 0);
  const u = transcriptTurns.length;

  const maxTokenKey = tokensByTurn.size > 0 ? Math.max(...tokensByTurn.keys()) : -1;
  const maxPromptKey = promptByRequest.size > 0 ? Math.max(...promptByRequest.keys()) : -1;
  const maxEarlyKey = earlyPrompts.size > 0 ? Math.max(...earlyPrompts.keys()) : -1;
  const total = Math.max(
    u,
    chatSession.requestCount ?? 0,
    maxTokenKey + 1,
    maxPromptKey + 1,
    maxEarlyKey + 1,
  );
  const offset = Math.max(0, total - u); // leading prompts missing from the transcript

  const events: PromptEvent[] = [];
  for (let n = 0; n < total; n++) {
    const turn = n >= offset ? transcriptTurns[n - offset] : undefined;
    let promptText = (turn?.promptText ?? '').trim();
    if (!promptText) promptText = earlyPrompts.get(n) ?? promptByRequest.get(n) ?? '';
    if (!promptText) continue;
    const real = tokensByTurn.get(n);
    events.push(
      buildPromptEvent({
        source: 'transcript',
        sessionId,
        userId,
        turnIndex: n,
        promptText,
        responseText: turn?.responseText || undefined,
        toolCalls: turn?.toolCalls ?? [],
        timestamp: turn?.startTime,
        model,
        inputTokensOverride: real?.promptTokens,
        outputTokensOverride: real?.completionTokens,
        copilotCredits: real?.copilotCredits,
      }),
    );
  }
  return events;
}
