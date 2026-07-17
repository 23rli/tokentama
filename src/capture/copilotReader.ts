import { readFileSync } from 'node:fs';
import type { PromptEvent } from '@tokentama/shared-types';
import { parseTranscript } from './parsers/transcriptParser';
import { parseChatSessionTokens } from './parsers/chatSessionTokens';
import { parseChatSession } from './parsers/chatSessionParser';
import { parseModelCatalog, resolveModel } from './parsers/modelCatalog';
import { buildPromptEvent } from './parsers/promptEventFactory';
import { reconcileSessionRequests } from './parsers/requestReconciler';
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
 * very first/older compacted turns. chatSessions is authoritative for logical
 * user requests, stable request IDs, completion state, and metering. Transcript
 * turns are matched by prompt text then timestamp to attach response/tool data.
 * Old transcript-only continuation artifacts are ignored; at most the newest
 * recent transcript-only request is exposed as genuinely pending.
 */
export function readSessionEvents(paths: CopilotSessionPaths, userId = 'local-user'): PromptEvent[] {
  const chatContent = safeRead(paths.chatSessionPath);
  const parsed = parseTranscript(safeRead(paths.transcriptPath));
  const tokensByTurn = parseChatSessionTokens(chatContent);
  const chatSession = parseChatSession(chatContent);
  const catalog = parseModelCatalog(safeRead(paths.modelsJsonPath));
  const model = resolveModel(chatSession.model, catalog);
  const sessionId = parsed.sessionId || paths.sessionId;

  // Transcript turns that carry a real user prompt, in order. One user request
  // can contain hundreds of assistant/tool subturns; the transcript parser has
  // already aggregated those under this user turn.
  const transcriptTurns = parsed.turns.filter((t) => (t.promptText ?? '').trim().length > 0);
  const firstPromptTurn = parsed.turns.findIndex(
    (t) => (t.promptText ?? '').trim().length > 0,
  );
  // Copilot's response to the omitted first prompt appears as a leading turn with
  // no promptText. Keep its response/tools instead of discarding useful history.
  const leadingTurns = parsed.turns.slice(
    0,
    firstPromptTurn < 0 ? parsed.turns.length : firstPromptTurn,
  );
  const reconciled = reconcileSessionRequests(chatSession.requests, transcriptTurns, {
    sourceModifiedMs: paths.modifiedMs,
  });
  // Copilot's response to the omitted first prompt appears as a leading turn.
  // Attach it to the earliest source request that did not match a user.message.
  const firstUnmatched = reconciled.requests.find((entry) => !entry.turn);
  if (firstUnmatched && leadingTurns[0]) firstUnmatched.turn = leadingTurns[0];

  const events: PromptEvent[] = [];
  for (const { request, turn } of reconciled.requests) {
    const real = tokensByTurn.get(request.turnIndex);
    const promptTokens = request.promptTokens ?? real?.promptTokens;
    const completionTokens = request.completionTokens ?? real?.completionTokens;
    const copilotCredits = request.copilotCredits ?? real?.copilotCredits;
    const tokenDetails = request.promptTokenDetails ?? real?.promptTokenDetails;
    const contextBreakdown =
      tokenDetails && promptTokens
        ? tokenDetails.map((d) => ({
            category: d.category,
            label: d.label,
            pct: d.percentageOfPrompt,
            tokens: Math.round((promptTokens * d.percentageOfPrompt) / 100),
          }))
        : undefined;
    events.push(
      buildPromptEvent({
        source: 'transcript',
        sessionId,
        sourceRequestId: request.requestId,
        userId,
        turnIndex: request.turnIndex,
        promptText: request.promptText,
        responseText: turn?.responseText || undefined,
        toolCalls: turn?.toolCalls ?? [],
        timestamp:
          request.timestamp ??
          (turn?.promptText ? turn.startTime : parsed.startTime) ??
          new Date(0).toISOString(),
        model,
        inputTokensOverride: promptTokens,
        outputTokensOverride: completionTokens,
        copilotCredits,
        sourceCompleted: request.completed,
        contextBreakdown,
      }),
    );
  }

  if (reconciled.pendingTurn?.promptText) {
    const turnIndex = Math.max(-1, ...chatSession.requests.map((request) => request.turnIndex)) + 1;
    events.push(
      buildPromptEvent({
        source: 'transcript',
        sessionId,
        userId,
        turnIndex,
        promptText: reconciled.pendingTurn.promptText,
        responseText: reconciled.pendingTurn.responseText || undefined,
        toolCalls: reconciled.pendingTurn.toolCalls,
        timestamp: reconciled.pendingTurn.startTime ?? new Date().toISOString(),
        model,
        sourceCompleted: false,
      }),
    );
  }
  return events;
}

/** The chat's display name (custom title), if the session was named. */
export function readSessionTitle(paths: CopilotSessionPaths): string | undefined {
  return parseChatSession(safeRead(paths.chatSessionPath)).title;
}
