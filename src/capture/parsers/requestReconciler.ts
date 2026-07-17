import type { ParsedChatRequest, ParsedTurn } from './types';

export interface ReconciledRequest {
  request: ParsedChatRequest;
  turn?: ParsedTurn;
}

export interface ReconciledSessionRequests {
  requests: ReconciledRequest[];
  /** At most one genuinely current transcript-only user request. */
  pendingTurn?: ParsedTurn;
  ignoredTranscriptTurns: number;
}

/**
 * Match source requests to transcript user turns without assuming array index
 * equality. Copilot may omit old transcript turns, and transcript-only UI
 * continuation/control messages may never become independent metered requests.
 */
export function reconcileSessionRequests(
  requests: readonly ParsedChatRequest[],
  transcriptTurns: readonly ParsedTurn[],
  options: { nowMs?: number; sourceModifiedMs?: number } = {},
): ReconciledSessionRequests {
  const unused = new Set(transcriptTurns.map((_, index) => index));
  const mapped: ReconciledRequest[] = [];
  let searchFloor = 0;

  for (const request of requests) {
    const requestText = normalizeText(request.promptText);
    const requestMs = timestampMs(request.timestamp);
    let match = chooseMatch(
      transcriptTurns,
      unused,
      (turn) => normalizeText(turn.promptText ?? '') === requestText,
      requestMs,
      searchFloor,
    );
    if (match == null && requestMs != null) {
      match = chooseMatch(
        transcriptTurns,
        unused,
        (turn) => {
          const turnMs = timestampMs(turn.startTime);
          return turnMs != null && Math.abs(turnMs - requestMs) <= 60_000;
        },
        requestMs,
        searchFloor,
      );
    }
    if (match != null) {
      unused.delete(match);
      searchFloor = match + 1;
      mapped.push({ request, turn: transcriptTurns[match] });
    } else {
      mapped.push({ request });
    }
  }

  const unmatched = [...unused]
    .map((index) => transcriptTurns[index])
    .filter((turn) => (turn.promptText ?? '').trim())
    .sort((a, b) => (timestampMs(a.startTime) ?? 0) - (timestampMs(b.startTime) ?? 0));
  const newest = unmatched.at(-1);
  const nowMs = options.nowMs ?? Date.now();
  const sourceModifiedMs = options.sourceModifiedMs ?? nowMs;
  const latestRequestMs = Math.max(
    0,
    ...requests.map((request) => timestampMs(request.timestamp) ?? 0),
  );
  const newestMs = timestampMs(newest?.startTime);
  const pendingTurn =
    newest &&
    newestMs != null &&
    newestMs > latestRequestMs &&
    nowMs - newestMs <= 5 * 60_000 &&
    sourceModifiedMs - newestMs <= 5 * 60_000 &&
    !isAutomaticContinuePrompt(newest.promptText ?? '')
      ? newest
      : undefined;

  return {
    requests: mapped,
    pendingTurn,
    ignoredTranscriptTurns: unmatched.length - (pendingTurn ? 1 : 0),
  };
}

function chooseMatch(
  turns: readonly ParsedTurn[],
  unused: ReadonlySet<number>,
  predicate: (turn: ParsedTurn) => boolean,
  targetMs: number | undefined,
  searchFloor: number,
): number | undefined {
  const candidates = [...unused]
    .filter((index) => index >= searchFloor)
    .filter((index) => predicate(turns[index]));
  if (candidates.length === 0) return undefined;
  if (targetMs == null) return candidates[0];
  return candidates.sort((a, b) => {
    const aDistance = Math.abs((timestampMs(turns[a].startTime) ?? targetMs) - targetMs);
    const bDistance = Math.abs((timestampMs(turns[b].startTime) ?? targetMs) - targetMs);
    return aDistance - bDistance || a - b;
  })[0];
}

export function isAutomaticContinuePrompt(text: string): boolean {
  const normalized = normalizeText(text);
  return /^continue:\s*["“]continue to iterate\??["”]$/i.test(normalized);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function timestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}
