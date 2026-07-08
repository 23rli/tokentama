/**
 * ACCURACY-IMPROVEMENT LAB — where is the remaining error, and what removes it?
 *
 * The point model is:  predict[N] = promptTokens[N-1] + completion[N-1] + GROWTH + draft[N].
 * Every term is EXACT (metered on disk) except GROWTH — the prior turn's tool-result
 * tokens added to history. So GROWTH is the ONLY thing we can improve. This lab
 * pits growth estimators against each other on real turns, using only what is known
 * at forecast time (turns 0..N-1, incl. turn N-1's already-observed tool calls):
 *
 *   median      : median of past residuals (CURRENT model)
 *   ema         : exp-weighted recent residuals (adapts to phase)
 *   recent3     : mean of the last 3 residuals
 *   last        : last residual (pure persistence)
 *   toolcount   : per-tool-call token rate × turn N-1's tool-call count
 *   tooltype    : separate rates for read / discovery / action tools
 *   blend       : max(median, toolcount) — a safe "surge-aware" floor
 *
 * Reports full-input MdAPE overall and per segment (steady/surge). Local, read-only.
 * Run: `npm run bench:forecast:improve`
 */
import { readFileSync } from 'node:fs';
import { listCopilotSessions } from '../src/capture/copilotPaths';
import { parseChatSessionTokens, type TurnTokens } from '@tokentama/ingestion';
import { estimateTokens } from '../src/scoring/models/tokenizer';

const MIN_TURNS = 8;

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
  completionTokens: number;
  reads: number;
  discovery: number;
  action: number;
  tools: number;
}

function parseTools(content: string): { promptText: string; reads: number; discovery: number; action: number; tools: number }[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const turns: ReturnType<typeof parseTools> = [];
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
      cur = { promptText: typeof d.content === 'string' ? d.content : '', reads: 0, discovery: 0, action: 0, tools: 0 };
      turns.push(cur);
    } else if (ev.type === 'tool.execution_start' && cur) {
      cur.tools++;
      const c = classifyTool(typeof d.toolName === 'string' ? d.toolName : '');
      if (c === 'read') cur.reads++;
      else if (c === 'discovery') cur.discovery++;
      else if (c === 'action') cur.action++;
    }
  }
  return turns;
}

function loadSession(s: ReturnType<typeof listCopilotSessions>[number]): Turn[] | undefined {
  const content = readText(s.transcriptPath);
  if (!content || !s.chatSessionPath) return undefined;
  const tt = parseTools(content).filter((t) => t.promptText.trim().length > 0);
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
      completionTokens: tok[i]?.completionTokens ?? 0,
      reads: tt[i].reads,
      discovery: tt[i].discovery,
      action: tt[i].action,
      tools: tt[i].tools,
    });
  }
  return out.length >= MIN_TURNS ? out : undefined;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// residual[i] = growth into turn i not explained by the known parts (≈ tool results of turn i-1).
function residualAt(turns: Turn[], i: number): number {
  const prev = turns[i - 1];
  const cur = turns[i];
  return Math.max(0, cur.promptTokens - prev.promptTokens - prev.completionTokens - estimateTokens(cur.promptText));
}

type Estimator = (turns: Turn[], n: number) => number; // predict residual for turn n, using 0..n-1

const estimators: Record<string, Estimator> = {
  median: (t, n) => median(Array.from({ length: n - 1 }, (_, k) => residualAt(t, k + 1))),
  ema: (t, n) => {
    const rs = Array.from({ length: n - 1 }, (_, k) => residualAt(t, k + 1));
    if (!rs.length) return 0;
    let e = rs[0];
    for (let i = 1; i < rs.length; i++) e = 0.5 * rs[i] + 0.5 * e;
    return e;
  },
  recent3: (t, n) => {
    const rs = Array.from({ length: n - 1 }, (_, k) => residualAt(t, k + 1));
    return median(rs.slice(-3));
  },
  last: (t, n) => (n >= 2 ? residualAt(t, n - 1) : 0),
  toolcount: (t, n) => {
    // per-tool-call token rate from history, applied to turn n-1's tool count.
    const rates: number[] = [];
    for (let k = 1; k < n; k++) {
      const tools = t[k - 1].tools;
      if (tools > 0) rates.push(residualAt(t, k) / tools);
    }
    const rate = median(rates);
    return rate * t[n - 1].tools;
  },
  tooltype: (t, n) => {
    // crude per-type rate: attribute each residual across that turn's tool mix.
    const rRead: number[] = [];
    const rDisc: number[] = [];
    const rAct: number[] = [];
    for (let k = 1; k < n; k++) {
      const g = t[k - 1];
      const res = residualAt(t, k);
      if (g.reads > 0 && g.discovery === 0 && g.action === 0) rRead.push(res / g.reads);
      else if (g.discovery > 0 && g.reads === 0 && g.action === 0) rDisc.push(res / g.discovery);
      else if (g.action > 0 && g.reads === 0 && g.discovery === 0) rAct.push(res / g.action);
    }
    const cr = median(rRead) || 0;
    const cd = median(rDisc) || 0;
    const ca = median(rAct) || 0;
    const g = t[n - 1];
    const est = cr * g.reads + cd * g.discovery + ca * g.action;
    // fall back to median if we have no per-type signal yet
    return est > 0 ? est : estimators.median(t, n);
  },
  blend: (t, n) => Math.max(estimators.median(t, n), estimators.toolcount(t, n)),
};

// ── Run ──────────────────────────────────────────────────────────────────────
console.log('\n=== Tokentama — ACCURACY-IMPROVEMENT LAB (which growth estimator wins?) ===\n');

const sessions = listCopilotSessions()
  .map(loadSession)
  .filter((t): t is Turn[] => Array.isArray(t))
  .sort((a, b) => b.length - a.length)
  .slice(0, 12);

if (sessions.length === 0) {
  console.log('No sessions with tool + token data.');
  process.exit(0);
}

interface Acc {
  all: number[];
  steady: number[];
  surge: number[];
}
const results: Record<string, Acc> = {};
for (const name of Object.keys(estimators)) results[name] = { all: [], steady: [], surge: [] };

let n = 0;
for (const turns of sessions) {
  for (let i = 1; i < turns.length; i++) {
    const actual = turns[i].promptTokens;
    const prev = turns[i - 1].promptTokens;
    if (actual < prev * 0.6) continue; // skip resets (flagged separately)
    const seg = actual > prev * 1.15 ? 'surge' : 'steady';
    n++;
    const fixed = prev + turns[i - 1].completionTokens + estimateTokens(turns[i].promptText);
    for (const [name, est] of Object.entries(estimators)) {
      const predicted = fixed + est(turns, i);
      const ape = Math.abs(predicted - actual) / actual;
      results[name].all.push(ape);
      (results[name] as any)[seg].push(ape);
    }
  }
}

console.log(`Corpus: ${sessions.length} sessions · ${n} non-reset predictions\n`);
console.log('estimator   │ overall MdAPE │ steady MdAPE │ surge MdAPE │ surge within ±20%');
console.log('────────────┼───────────────┼──────────────┼─────────────┼──────────────────');
const rank: [string, number][] = [];
for (const name of Object.keys(estimators)) {
  const a = results[name];
  const md = median(a.all) * 100;
  const st = median(a.steady) * 100;
  const su = median(a.surge) * 100;
  const suW = Math.round((a.surge.filter((x) => x <= 0.2).length / Math.max(1, a.surge.length)) * 100);
  rank.push([name, md]);
  const mark = name === 'median' ? '  (current)' : '';
  console.log(
    `${name.padEnd(11)} │ ${(md.toFixed(1) + '%').padStart(12)} │ ${(st.toFixed(1) + '%').padStart(12)} │ ${(su.toFixed(1) + '%').padStart(11)} │ ${(suW + '%').padStart(8)}${mark}`,
  );
}

rank.sort((a, b) => a[1] - b[1]);
const best = rank[0];
const cur = rank.find((r) => r[0] === 'median')![1];
console.log(
  `\nBest overall: ${best[0]} (MdAPE ${best[1].toFixed(1)}%) vs current 'median' (${cur.toFixed(1)}%) → ` +
    `${cur > 0 ? Math.round((1 - best[1] / cur) * 100) : 0}% lower median error.`,
);
console.log(
  '\nHow to read this: the growth term is the ONLY improvable part (all others are metered).\n' +
    'If a tool-aware estimator beats median on the SURGE column without hurting steady, adopt it —\n' +
    'it is still free (uses tool-call counts already on disk, no model call). If nothing beats\n' +
    'median meaningfully, the surge is genuinely unpredictable and the INTERVAL is the honest\n' +
    'answer, not a better point. One dev, one machine — directional.\n',
);
