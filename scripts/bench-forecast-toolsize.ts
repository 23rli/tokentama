/**
 * TOOL-SIZE DIAGNOSTIC — can we recover tool "hunger" from disk after all?
 *
 * Growth (the only unpredictable term) is driven by tool OUTPUT size, which isn't
 * stored. BUT the transcript records each tool call's ARGUMENTS — for file reads,
 * the filePath (+ line range). Those files are in the workspace, so we can
 * RECONSTRUCT the read size by reading them ourselves. This tests whether that
 * reconstructed size predicts the next turn's growth far better than tool-count
 * (the current r≈0.20 proxy). If yes, MCP-free / file-heavy turns become
 * predictable; MCP output stays unmeasurable but detectable.
 *
 * Local, read-only. Run: `npm run bench:forecast:toolsize`
 */
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

/** Pull file path(s) + optional line range out of a tool call's arguments. */
function readSizeTokens(args: any): number {
  if (!args || typeof args !== 'object') return 0;
  const paths: string[] = [];
  const pushPath = (v: unknown): void => {
    if (typeof v === 'string' && /[\w./\\-]+\.\w{1,6}$/.test(v)) paths.push(v);
  };
  pushPath(args.filePath);
  if (Array.isArray(args.filePaths)) args.filePaths.forEach(pushPath);
  pushPath(args.path);
  if (paths.length === 0) return 0;

  let total = 0;
  for (const p of paths) {
    const local = p.startsWith('file://') ? safeFsPath(p) : p;
    const content = readText(local);
    if (!content) {
      // File gone/changed — fall back to a modest constant so we don't zero it out.
      total += 400;
      continue;
    }
    if (typeof args.startLine === 'number' && typeof args.endLine === 'number' && args.endLine >= args.startLine) {
      const lines = content.split(/\r?\n/);
      const slice = lines.slice(Math.max(0, args.startLine - 1), args.endLine).join('\n');
      total += estimateTokens(slice);
    } else {
      total += estimateTokens(content);
    }
  }
  return total;
}

function safeFsPath(uri: string): string {
  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}

type ToolClass = 'discovery' | 'read' | 'action' | 'other';
function classify(n: string): ToolClass {
  const s = n.toLowerCase();
  if (/(semantic|search|grep|find|list_dir|usages)/.test(s)) return 'discovery';
  if (/(read_file|read|get_errors|fetch|open)/.test(s)) return 'read';
  if (/(edit|replace|create|insert|apply|write|terminal|run)/.test(s)) return 'action';
  return 'other';
}

interface Turn {
  promptTokens: number;
  completionTokens: number;
  promptText: string;
  tools: number;
  readTokens: number; // reconstructed file-read size
}

function parseTurns(content: string): Omit<Turn, 'promptTokens' | 'completionTokens'>[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const turns: Omit<Turn, 'promptTokens' | 'completionTokens'>[] = [];
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
      cur = { promptText: typeof d.content === 'string' ? d.content : '', tools: 0, readTokens: 0 };
      turns.push(cur);
    } else if (ev.type === 'tool.execution_start' && cur) {
      cur.tools++;
      if (classify(typeof d.toolName === 'string' ? d.toolName : '') === 'read') {
        cur.readTokens += readSizeTokens(d.arguments);
      }
    }
  }
  return turns;
}

function loadSession(s: ReturnType<typeof listCopilotSessions>[number]): Turn[] | undefined {
  const content = readText(s.transcriptPath);
  if (!content || !s.chatSessionPath) return undefined;
  const tt = parseTurns(content).filter((t) => t.promptText.trim().length > 0);
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
    out.push({ ...tt[i], promptTokens: pt, completionTokens: tok[i]?.completionTokens ?? 0 });
  }
  return out.length >= MIN_TURNS ? out : undefined;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
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
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : NaN;
}

// ── Run ──────────────────────────────────────────────────────────────────────
console.log('\n=== Tokentama — TOOL-SIZE DIAGNOSTIC (reconstructed read size vs growth) ===\n');

const sessions = listCopilotSessions()
  .map(loadSession)
  .filter((t): t is Turn[] => Array.isArray(t))
  .sort((a, b) => b.length - a.length)
  .slice(0, 12);

if (sessions.length === 0) {
  console.log('No sessions.');
  process.exit(0);
}

const growth: number[] = [];
const readTok: number[] = [];
const toolCnt: number[] = [];
const apeToolcount: number[] = [];
const apeReadsize: number[] = [];
const apeMedian: number[] = [];

for (const turns of sessions) {
  const residuals: number[] = [];
  for (let i = 1; i < turns.length; i++) {
    const g = turns[i].promptTokens - turns[i - 1].promptTokens;
    if (g < 0) continue; // reset
    growth.push(g);
    readTok.push(turns[i - 1].readTokens);
    toolCnt.push(turns[i - 1].tools);

    // Compare full-input prediction using each growth proxy (history 0..i-1 only).
    const fixed = turns[i - 1].promptTokens + turns[i - 1].completionTokens + estimateTokens(turns[i].promptText);
    const actual = turns[i].promptTokens;
    // median residual so far
    const medGrowth = median(residuals);
    // toolcount rate so far
    const rates: number[] = [];
    const readRates: number[] = [];
    for (let k = 1; k < i; k++) {
      const res = Math.max(0, turns[k].promptTokens - turns[k - 1].promptTokens - turns[k - 1].completionTokens - estimateTokens(turns[k].promptText));
      if (turns[k - 1].tools > 0) rates.push(res / turns[k - 1].tools);
      if (turns[k - 1].readTokens > 0) readRates.push(res / turns[k - 1].readTokens);
    }
    const tcEst = (median(rates) || 0) * turns[i - 1].tools;
    const rsEst = (median(readRates) || 1) * turns[i - 1].readTokens;
    apeMedian.push(Math.abs(fixed + medGrowth - actual) / actual);
    apeToolcount.push(Math.abs(fixed + Math.max(medGrowth, tcEst) - actual) / actual);
    apeReadsize.push(Math.abs(fixed + Math.max(medGrowth, rsEst) - actual) / actual);

    residuals.push(Math.max(0, g - turns[i - 1].completionTokens - estimateTokens(turns[i].promptText)));
  }
}

console.log(`Corpus: ${sessions.length} sessions · ${growth.length} non-reset turns\n`);
console.log('--- Signal correlation with growth ---');
console.log(`  reconstructed read tokens ↔ growth : r = ${pearson(readTok, growth).toFixed(2)}  (R² ${(pearson(readTok, growth) ** 2 * 100).toFixed(0)}%)`);
console.log(`  tool-call count           ↔ growth : r = ${pearson(toolCnt, growth).toFixed(2)}  (R² ${(pearson(toolCnt, growth) ** 2 * 100).toFixed(0)}%)`);
console.log('\n--- Full-input prediction MdAPE with each growth proxy ---');
console.log(`  median (baseline)     : ${(median(apeMedian) * 100).toFixed(1)}%`);
console.log(`  + tool-count          : ${(median(apeToolcount) * 100).toFixed(1)}%`);
console.log(`  + reconstructed reads : ${(median(apeReadsize) * 100).toFixed(1)}%`);
console.log(
  '\nHow to read this: if reconstructed read tokens correlate much more strongly than tool count\n' +
    'and lower the MdAPE, then reading the workspace files a turn touched recovers the growth signal\n' +
    'for built-in file reads — cracking surges for non-MCP users. MCP tool output stays unmeasurable\n' +
    '(re-running the call is out of scope), but is DETECTABLE via source=external. One dev, one machine.\n',
);
