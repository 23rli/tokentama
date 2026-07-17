import type { ParsedTranscript, ParsedTurn } from './types';
import { attributeToolCall } from './toolAttribution';

interface Envelope {
  type?: string;
  data?: Record<string, any>;
  id?: string;
  timestamp?: string;
  parentId?: string | null;
}

/**
 * Parse a Copilot `transcripts/<id>.jsonl` append-only event stream into
 * per-user-turn data: the user's prompt (`user.message`), the assistant's
 * aggregated response, and tool calls (with success + duration). One user
 * prompt can drive many assistant sub-turns; they are merged into that turn.
 */
export function parseTranscript(content: string): ParsedTranscript {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  let sessionId = '';
  let startTime: string | undefined;
  const turns: ParsedTurn[] = [];
  const toolStart = new Map<
    string,
    { name: string; ts?: string } & ReturnType<typeof attributeToolCall>
  >();
  let current: ParsedTurn | undefined;

  const ensureTurn = (ts?: string): ParsedTurn => {
    if (!current) {
      current = { turnIndex: turns.length, responseText: '', toolCalls: [], startTime: ts };
      turns.push(current);
    }
    return current;
  };

  for (const line of lines) {
    let ev: Envelope;
    try {
      ev = JSON.parse(line) as Envelope;
    } catch {
      continue;
    }
    const d = ev.data ?? {};
    switch (ev.type) {
      case 'session.start':
        sessionId = typeof d.sessionId === 'string' ? d.sessionId : sessionId;
        startTime ??= ev.timestamp;
        break;
      case 'user.message': {
        // A new user prompt always starts a new turn.
        current = {
          turnIndex: turns.length,
          promptText: typeof d.content === 'string' ? d.content : '',
          responseText: '',
          toolCalls: [],
          startTime: ev.timestamp,
        };
        turns.push(current);
        break;
      }
      case 'assistant.turn_start': {
        const t = ensureTurn(ev.timestamp);
        if (!t.startTime) t.startTime = ev.timestamp;
        break;
      }
      case 'assistant.turn_end': {
        if (current) current.endTime = ev.timestamp;
        break;
      }
      case 'assistant.message': {
        const t = ensureTurn(ev.timestamp);
        if (typeof d.content === 'string' && d.content.length > 0) {
          t.responseText += (t.responseText ? '\n' : '') + d.content;
        }
        if (Array.isArray(d.toolRequests)) {
          for (const tr of d.toolRequests) {
            if (tr?.toolCallId && tr?.name) {
              toolStart.set(tr.toolCallId, {
                ...toolStart.get(tr.toolCallId),
                name: tr.name,
                ...mergeAttribution(
                  toolStart.get(tr.toolCallId),
                  attributeToolCall(tr.name, tr.arguments),
                ),
              });
            }
          }
        }
        break;
      }
      case 'tool.execution_start': {
        if (d.toolCallId) {
          const name = d.toolName ?? toolStart.get(d.toolCallId)?.name ?? 'unknown';
          const previous = toolStart.get(d.toolCallId);
          toolStart.set(d.toolCallId, {
            ...previous,
            name,
            ts: ev.timestamp,
            ...mergeAttribution(previous, attributeToolCall(name, d.arguments)),
          });
        }
        break;
      }
      case 'tool.execution_complete': {
        const t = ensureTurn(ev.timestamp);
        const started = d.toolCallId ? toolStart.get(d.toolCallId) : undefined;
        const durationMs =
          started?.ts && ev.timestamp
            ? Math.max(0, Date.parse(ev.timestamp) - Date.parse(started.ts))
            : undefined;
        t.toolCalls.push({
          toolName: started?.name ?? d.toolName ?? 'unknown',
          toolCallId: d.toolCallId,
          success: typeof d.success === 'boolean' ? d.success : undefined,
          durationMs,
          toolKind: started?.toolKind,
          loadedSkills: started?.loadedSkills,
        });
        break;
      }
      default:
        break;
    }
  }

  return { sessionId, startTime, turns };
}

function mergeAttribution(
  previous: ReturnType<typeof attributeToolCall> | undefined,
  next: ReturnType<typeof attributeToolCall>,
): ReturnType<typeof attributeToolCall> {
  const loadedSkills = [...new Set([...(previous?.loadedSkills ?? []), ...(next.loadedSkills ?? [])])];
  return {
    toolKind: next.toolKind ?? previous?.toolKind,
    loadedSkills: loadedSkills.length > 0 ? loadedSkills : undefined,
  };
}
