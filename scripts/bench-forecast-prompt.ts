/**
 * PROMPT-SIGNAL DIAGNOSTIC — "can taking the prompt into account improve the
 * forecast, and could an AI model help?"
 *
 * The lab showed the error lives in SURGES (a turn adds a lot of new context).
 * The arithmetic can't see them because it only looks at token history, never at
 * what the prompt ASKS. This measures, on real sessions, whether the prompt (and
 * the turn's tool activity) predicts the growth a turn generates — i.e. whether a
 * prompt-aware model (heuristic OR LLM) has any signal to exploit. Evidence first.
 *
 * Accounting: growth[N] = promptTokens[N] − promptTokens[N−1]
 *   = completion[N−1] + toolResults[N−1] + promptText[N].
 * So the "hunger a turn GENERATES" (turn K) ≈ growthNext[K] = promptTokens[K+1] −
 * promptTokens[K]. We correlate that with (a) turn K's PROMPT features (pre-send,
 * what the compose box has) and (b) turn K's TOOL activity (known once the turn
 * ran — a free structural signal for the NEXT input forecast).
 *
 * Local, read-only. Run: `npm run bench:forecast:prompt`
 */
import { readFileSync } from 'node:fs';
import { listCopilotSessions } from '../src/capture/copilotPaths';
import { parseTranscript, parseChatSessionTokens, type TurnTokens } from '@tokentama/ingestion';
import { estimateTokens } from '../src/scoring/models/tokenizer';

const MIN_TURNS = 6;

function readText(p: string): string {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

type ToolClass = 'discovery' | 'read' | 'action' | 'other';
function classifyTool(nameRaw: string): ToolClass {
  const n = nameRaw.toLowerCase();
  if (/(semantic|search|grep|find|list_dir|list_code|usages|lookup)/.test(n)) return 'discovery';
  if (/(read_file|read|get_errors|fetch|open|view)/.test(n)) return 'read';
  if (/(edit|replace|create|insert|apply|write|run_in_terminal|terminal|patch|new_file)/.test(n))
    return 'action';
  return 'other';
}

interface Turn {
  promptText: string;
  promptTokens: number;
  completionTokens?: number;
  toolCalls: number;
  discovery: number;
  reads: number;
}

/** Parse a transcript into turns with tool-call counts (needs raw args, so parse directly). */
function parseTurnsWithTools(content: string): { promptText: string; toolCalls: number; discovery: number; reads: number }[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const turns: { promptText: string; toolCalls: number; discovery: number; reads: number }[] = [];
  let cur: (typeof turns)[number] | undefined;
  for (const line of lines) {
    let ev: { type?: string; data?: Record<string, any> };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const d = ev.data ?? {};
    if (ev.type === 'user.message') {
      cur = { promptText: typeof d.content === 'string' ? d.content : '', toolCalls: 0, discovery: 0, reads: 0 };
      turns.push(cur);
    } else if (ev.type === 'tool.execution_start' && cur) {
      cur.toolCalls++;
      const cls = classifyTool(typeof d.toolName === 'string' ? d.toolName : '');
      if (cls === 'discovery') cur.discovery++;
      else if (cls === 'read') cur.reads++;
    }
  }
  return turns;
}

function loadSession(s: ReturnType<typeof listCopilotSessions>[number]): Turn[] | undefined {
  const content = readText(s.transcriptPath);
  if (!content || !s.chatSessionPath) return undefined;
  const tt = parseTurnsWithTools(content).filter((t) => t.promptText.trim().length > 0);
  if (tt.length < MIN_TURNS) return undefined;
  const chat = readText(s.chatSessionPath);
  if (!chat) return undefined;
  const tok: (TurnTokens | undefined)[] = [...parseChatSessionTokens(chat).entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
  const out: Turn[] = [];
  for (let i = 0; i < tt.length; i++) {
    const pt = tok[i]?.promptTokens;
    if (typeof pt !== 'number' || pt <= 0) continue;
    out.push({
      promptText: tt[i].promptText.trim(),
      promptTokens: pt,
      completionTokens: tok[i]?.completionTokens,
      toolCalls: tt[i].toolCalls,
      discovery: tt[i].discovery,
      reads: tt[i].reads,
    });
  }
  return out.length >= MIN_TURNS ? out : undefined;
}

// ── Prompt features (pre-send: all we have in the compose box) ────────────────
const RE_EXPLORE = /\b(analy[sz]e|review|find|search|explore|look|check|investigat|understand|audit|trace|examine|inspect|scan|list|walk through|go through|compare|debug|diagnos)/gi;
const RE_SCOPE = /\b(all|entire|whole|everything|across|each|every|throughout|codebase|project|repo|repositor|the app|end.to.end)/gi;
const RE_EDIT = /\b(add|fix|change|update|rename|remove|delete|refactor|implement|create|write|make|wire|build)\b/gi;
const RE_FILE = /[\w./-]+\.(ts|tsx|js|jsx|mjs|cjs|py|md|json|css|scss|html|java|go|rs|c|cpp|h|yml|yaml|sql|sh)\b/gi;

interface Features {
  tokens: number;
  hasCode: number;
  explore: number;
  scope: number;
  edit: number;
  files: number;
}
function features(prompt: string): Features {
  return {
    tokens: estimateTokens(prompt),
    hasCode: /```/.test(prompt) ? 1 : 0,
    explore: (prompt.match(RE_EXPLORE) ?? []).length,
    scope: (prompt.match(RE_SCOPE) ?? []).length,
    edit: (prompt.match(RE_EDIT) ?? []).length,
    files: (prompt.match(RE_FILE) ?? []).length,
  };
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 3) return NaN;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? NaN : num / den;
}

// ── Run ──────────────────────────────────────────────────────────────────────
console.log('\n=== Tokentama — PROMPT-SIGNAL DIAGNOSTIC (does the prompt predict the hunger?) ===\n');

const sessions = listCopilotSessions()
  .map(loadSession)
  .filter((t): t is Turn[] => Array.isArray(t))
  .sort((a, b) => b.length - a.length)
  .slice(0, 12);

if (sessions.length === 0) {
  console.log('No sessions with tool + token data found.');
  process.exit(0);
}

// Build the sample: for each turn K (not last, and not a reset boundary), the
// growth it GENERATES = promptTokens[K+1] − promptTokens[K].
interface Sample {
  f: Features;
  toolCalls: number;
  discovery: number;
  reads: number;
  growthNext: number;
  surge: boolean;
}
const samples: Sample[] = [];
for (const turns of sessions) {
  for (let k = 0; k < turns.length - 1; k++) {
    const growthNext = turns[k + 1].promptTokens - turns[k].promptTokens;
    if (growthNext < 0) continue; // skip summarization resets — handled separately
    const ratio = turns[k + 1].promptTokens / Math.max(1, turns[k].promptTokens);
    samples.push({
      f: features(turns[k].promptText),
      toolCalls: turns[k].toolCalls,
      discovery: turns[k].discovery,
      reads: turns[k].reads,
      growthNext,
      surge: ratio > 1.15,
    });
  }
}

console.log(`Corpus: ${sessions.length} sessions · ${samples.length} non-reset turns\n`);

const g = samples.map((s) => s.growthNext);

console.log('--- A) PRE-SEND: does the PROMPT text predict the growth it generates? ---');
const featKeys: (keyof Features)[] = ['tokens', 'hasCode', 'explore', 'scope', 'edit', 'files'];
for (const key of featKeys) {
  const r = pearson(samples.map((s) => s.f[key]), g);
  console.log(`  prompt.${key.padEnd(8)} ↔ growth : r = ${Number.isNaN(r) ? ' n/a' : r.toFixed(2).padStart(5)}`);
}

console.log('\n--- B) POST-RUN: does the turn\'s TOOL activity predict the growth (free structural signal)? ---');
console.log(`  toolCalls ↔ growth : r = ${pearson(samples.map((s) => s.toolCalls), g).toFixed(2)}`);
console.log(`  discovery ↔ growth : r = ${pearson(samples.map((s) => s.discovery), g).toFixed(2)}`);
console.log(`  reads     ↔ growth : r = ${pearson(samples.map((s) => s.reads), g).toFixed(2)}`);

// Surge lift: how much more likely is a surge when a prompt has exploration/scope signal?
const withExplore = samples.filter((s) => s.f.explore + s.f.scope > 0);
const without = samples.filter((s) => s.f.explore + s.f.scope === 0);
const rate = (xs: Sample[]): number => (xs.length ? xs.filter((s) => s.surge).length / xs.length : 0);
console.log('\n--- C) Surge lift from prompt intent ---');
console.log(`  surge rate | prompt has explore/scope words : ${(rate(withExplore) * 100).toFixed(0)}%  (n=${withExplore.length})`);
console.log(`  surge rate | prompt has none                : ${(rate(without) * 100).toFixed(0)}%  (n=${without.length})`);
console.log(`  base surge rate                             : ${(rate(samples) * 100).toFixed(0)}%`);

// Simple explanatory power: variance of growth explained by a 1-var toolCalls model,
// vs by the best single prompt feature. R² = r².
const bestPrompt = Math.max(...featKeys.map((k) => Math.abs(pearson(samples.map((s) => s.f[k]), g)) || 0));
const rTools = Math.abs(pearson(samples.map((s) => s.toolCalls), g));
console.log('\n--- D) Explanatory ceiling (R² = variance of growth explained) ---');
console.log(`  best single PROMPT feature : R² ≈ ${(bestPrompt ** 2 * 100).toFixed(0)}%  (this is the pre-send ceiling for a 1-feature model)`);
console.log(`  turn TOOL-CALL count       : R² ≈ ${(rTools ** 2 * 100).toFixed(0)}%  (post-run; drives the NEXT input forecast for free)`);

console.log(
  '\nHow to read this:\n' +
    '  (A) If prompt features have |r| meaningfully > 0, the prompt HAS signal → a prompt-aware\n' +
    '      model (heuristic or AI) can improve the surge case. If ~0, prompts do NOT help and we\n' +
    '      should not add an AI call for it.\n' +
    '  (B) If tool activity has strong r, we get a FREE accuracy win: once a turn has run we know\n' +
    '      its tool calls, so the next input forecast can use them instead of a session-median.\n' +
    '  (D) The R² numbers bound how "perfect" any model could get. An AI model only earns its\n' +
    '      token cost if it beats the free prompt ceiling in (A). One dev, one machine — directional.\n',
);
