import type { ModelInfo } from '@tokentama/shared-types';
import type { ParsedChatSession, ParsedChatRequest } from './types';

interface ChatLine {
  kind?: number;
  k?: (string | number)[];
  v?: any;
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
    if (parsed.kind === 0) {
      state = parsed.v ?? {};
    } else if ((parsed.kind === 1 || parsed.kind === 2) && parsed.k) {
      try {
        applyPatch(state, parsed.k, parsed.v);
      } catch {
        /* ignore malformed patch */
      }
    }
  }

  const meta = state?.inputState?.selectedModel?.metadata;
  const model: ModelInfo | undefined = meta
    ? {
        id: meta.id ?? meta.family ?? 'unknown',
        family: meta.family ?? meta.id ?? 'unknown',
        vendor: meta.vendor,
        maxInputTokens: meta.maxInputTokens,
        maxOutputTokens: meta.maxOutputTokens,
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
      completionTokens:
        typeof req?.completionTokens === 'number' ? req.completionTokens : undefined,
      elapsedMs: typeof req?.elapsedMs === 'number' ? req.elapsedMs : undefined,
    });
  });

  return { sessionId: state?.sessionId ?? '', model, requests, requestCount: reqArr.length };
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
