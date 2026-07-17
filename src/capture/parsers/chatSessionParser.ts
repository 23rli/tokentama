import type { ModelInfo } from '@tokentama/shared-types';
import type { ParsedChatSession, ParsedChatRequest } from './types';

interface ChatLine {
  kind?: number;
  k?: (string | number)[];
  v?: any;
}

function applyChatLine(state: any, parsed: ChatLine): any {
  if (parsed.kind === 0) return parsed.v ?? {};
  if ((parsed.kind !== 1 && parsed.kind !== 2) || !parsed.k) return state;
  // New requests are emitted as kind:2 appends at ["requests"]. Assignment
  // silently loses all prior requests and corrupts prompt/token alignment.
  if (
    parsed.kind === 2 &&
    parsed.k.length === 1 &&
    parsed.k[0] === 'requests' &&
    Array.isArray(parsed.v)
  ) {
    if (!Array.isArray(state.requests)) state.requests = [];
    state.requests.push(...parsed.v);
    return state;
  }
  applyPatch(state, parsed.k, parsed.v);
  return state;
}

/** Apply a kind:1/kind:2 patch by walking the key path and setting the final key. */
function applyPatch(state: any, k: (string | number)[], v: any): void {
  if (!Array.isArray(k) || k.length === 0 || state == null) return;
  let cur = state;
  for (let i = 0; i < k.length - 1; i++) {
    const key = k[i] as string | number;
    if (cur[key] == null || typeof cur[key] !== 'object') {
      cur[key] = typeof k[i + 1] === 'number' ? [] : {};
    }
    cur = cur[key];
  }
  cur[k[k.length - 1] as string | number] = v;
}

const USER_REQUEST_RE = /<userRequest>([\s\S]*?)<\/userRequest>/i;

/** The rendered message is wrapped in injected context; keep only what the user typed. */
export function extractUserText(raw: string | undefined): string {
  if (!raw) return '';
  const match = raw.match(USER_REQUEST_RE);
  return (match?.[1] ?? raw).trim();
}

function promptFromRequest(req: any): string {
  if (!req || typeof req !== 'object') return '';

  const rendered = req.result?.metadata?.renderedUserMessage;
  if (Array.isArray(rendered)) {
    const joined = rendered.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('\n');
    const extracted = extractUserText(joined);
    if (extracted) return extracted;
  }

  const msg = req.message;
  if (typeof msg?.text === 'string' && msg.text.trim()) return extractUserText(msg.text);
  if (Array.isArray(msg?.parts)) {
    const joined = msg.parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join(' ');
    if (joined.trim()) return extractUserText(joined);
  }
  return '';
}

/**
 * Parse a VS Code `chatSessions/<id>.jsonl` file into user requests + selected
 * model. Reconstructs state from the kind:0 snapshot and kind:1/kind:2 patches.
 * Schema confirmed against the live session (design research).
 */
export function parseChatSession(content: string): ParsedChatSession {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  let state: any = {};

  for (const line of lines) {
    let parsed: ChatLine;
    try {
      parsed = JSON.parse(line) as ChatLine;
    } catch {
      continue;
    }
    try {
      state = applyChatLine(state, parsed);
    } catch {
      /* ignore malformed patch */
    }
  }

  const meta = state?.inputState?.selectedModel?.metadata;
  const modelConfig = state?.inputState?.modelConfiguration;
  // The selected reasoning effort is often only present in a later patch that the
  // snapshot reconstruction may not surface, so fall back to the LAST occurrence
  // of "reasoningEffort":"<value>" anywhere in the file (most-recent selection).
  const effortMatches = [...content.matchAll(/"reasoningEffort"\s*:\s*"([^"]+)"/g)];
  const selectedEffort =
    (typeof modelConfig?.reasoningEffort === 'string' ? modelConfig.reasoningEffort : undefined) ??
    (effortMatches.length ? effortMatches[effortMatches.length - 1][1] : undefined);
  const model: ModelInfo | undefined = meta
    ? {
        id: meta.id ?? meta.family ?? 'unknown',
        family: meta.family ?? meta.id ?? 'unknown',
        vendor: meta.vendor,
        maxInputTokens: meta.maxInputTokens,
        maxOutputTokens: meta.maxOutputTokens,
        reasoningEffort: selectedEffort,
      }
    : undefined;

  const requests: ParsedChatRequest[] = [];
  const reqArr = Array.isArray(state?.requests) ? state.requests : [];
  reqArr.forEach((req: any, idx: number) => {
    const promptText = promptFromRequest(req);
    if (!promptText) return;
    requests.push({
      turnIndex: idx,
      promptText,
      requestId: typeof req?.requestId === 'string' ? req.requestId : undefined,
      timestamp: normalizeRequestTimestamp(req?.timestamp),
      promptTokens: typeof req?.promptTokens === 'number' ? req.promptTokens : undefined,
      completionTokens:
        typeof req?.completionTokens === 'number' ? req.completionTokens : undefined,
      copilotCredits:
        typeof req?.copilotCredits === 'number' ? req.copilotCredits : undefined,
      promptTokenDetails: Array.isArray(req?.promptTokenDetails)
        ? req.promptTokenDetails.filter((detail: any) =>
            detail != null &&
            typeof detail.category === 'string' &&
            typeof detail.label === 'string' &&
            typeof detail.percentageOfPrompt === 'number',
          )
        : undefined,
      completed:
        typeof req?.completionTokens === 'number' ||
        req?.result != null ||
        req?.response != null,
      elapsedMs: typeof req?.elapsedMs === 'number' ? req.elapsedMs : undefined,
    });
  });

  return {
    sessionId: state?.sessionId ?? '',
    title: typeof state?.customTitle === 'string' ? state.customTitle : undefined,
    model,
    requests,
    requestCount: reqArr.length,
  };
}

function normalizeRequestTimestamp(value: unknown): string | undefined {
  const milliseconds =
    typeof value === 'number'
      ? value < 1_000_000_000_000 ? value * 1000 : value
      : typeof value === 'string'
        ? Date.parse(value)
        : Number.NaN;
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined;
}

/**
 * Extract prompts from the kind:0 snapshot(s), keyed by request index. The
 * snapshot preserves the ORIGINAL request order + messages — including the
 * session's first prompt — which the later kind:1/kind:2 patches reorganize and
 * overwrite. First snapshot wins per index.
 */
export function parseEarlyPrompts(content: string): Map<number, string> {
  const byIndex = new Map<number, string>();
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (const line of lines) {
    let parsed: ChatLine;
    try {
      parsed = JSON.parse(line) as ChatLine;
    } catch {
      continue;
    }
    if (parsed.kind !== 0) continue;
    const requests = (parsed.v as { requests?: unknown })?.requests;
    if (!Array.isArray(requests)) continue;
    requests.forEach((req: unknown, idx: number) => {
      if (byIndex.has(idx)) return;
      const text = promptFromRequest(req);
      if (text) byIndex.set(idx, text);
    });
  }
  return byIndex;
}

/** Stable source-native request IDs keyed by request index (last write wins). */
export function parseChatSessionRequestIds(content: string): Map<number, string> {
  const byIndex = new Map<number, string>();
  let requestCount = 0;
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (const line of lines) {
    let parsed: ChatLine;
    try {
      parsed = JSON.parse(line) as ChatLine;
    } catch {
      continue;
    }
    if (parsed.kind === 0) {
      const requests = (parsed.v as { requests?: unknown })?.requests;
      if (!Array.isArray(requests)) continue;
      requestCount = requests.length;
      requests.forEach((request: any, index: number) => {
        if (typeof request?.requestId === 'string' && request.requestId) {
          byIndex.set(index, request.requestId);
        }
      });
      continue;
    }
    if (
      (parsed.kind === 1 || parsed.kind === 2) &&
      Array.isArray(parsed.k) &&
      parsed.k.length === 1 &&
      parsed.k[0] === 'requests' &&
      Array.isArray(parsed.v)
    ) {
      parsed.v.forEach((request: any, offset: number) => {
        if (typeof request?.requestId === 'string' && request.requestId) {
          byIndex.set(requestCount + offset, request.requestId);
        }
      });
      requestCount += parsed.v.length;
      continue;
    }
    if (
      (parsed.kind === 1 || parsed.kind === 2) &&
      Array.isArray(parsed.k) &&
      parsed.k.length === 2 &&
      parsed.k[0] === 'requests' &&
      typeof parsed.k[1] === 'number' &&
      typeof parsed.v?.requestId === 'string' &&
      parsed.v.requestId
    ) {
      byIndex.set(parsed.k[1], parsed.v.requestId);
      continue;
    }
    if (
      (parsed.kind === 1 || parsed.kind === 2) &&
      Array.isArray(parsed.k) &&
      parsed.k[0] === 'requests' &&
      typeof parsed.k[1] === 'number' &&
      parsed.k[2] === 'requestId' &&
      typeof parsed.v === 'string' &&
      parsed.v
    ) {
      byIndex.set(parsed.k[1], parsed.v);
    }
  }
  return byIndex;
}
