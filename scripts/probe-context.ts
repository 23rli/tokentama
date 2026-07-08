/**
 * PIVOT PROBE — "does prompt phrasing drive context load?"
 *
 * The post-senior-SWE pivot bets on ONE thing: a more precise prompt makes the
 * agent load LESS context (fewer exploratory searches/reads), and since re-sent
 * context is ~87% of the bill, that is the only user-controllable lever worth
 * shipping. This probe VALIDATES that premise on your REAL Copilot history
 * before we build any UI — same "measure first" discipline as every other claim.
 *
 * Ground truth per turn (all read from disk, local):
 *   - prompt specificity: does the ask name a concrete target (file/path/symbol/code)?
 *   - exploration: how many DISCOVERY tool calls (search/grep/list/read) it triggered.
 *   - context size: real `promptTokens` for the turn (full model input).
 *
 * The test: do SPECIFIC prompts trigger measurably LESS exploration / smaller
 * context than VAGUE ones? If yes, the feature has legs. If no, the pivot is
 * also a dead end and we should know now.
 *
 * Run: `npm run probe:context`  (or: node scripts/run-bench.mjs probe-context.ts)
 */
import { readFileSync } from 'node:fs';
import { listCopilotSessions } from '../src/capture/copilotPaths';
import { parseTranscript, parseChatSessionTokens, type TurnTokens } from '@tokentama/ingestion';

const MIN_TURNS = 8;
const N_SESSIONS = 8; // widen a bit — we want turn count, not just the 5 longest

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

// ── Tool categorisation ──────────────────────────────────────────────────────
// We only rely on the tool NAME (all that's on disk). DISCOVERY = the agent
// hunting for context because the prompt didn't pin it. READ = pulling a file's
// contents into context. ACTION = actually doing the work. Discovery+Read are
// the "context load" the prompt can influence; Action is not.
type ToolClass = 'discovery' | 'read' | 'action' | 'other';

function classifyTool(nameRaw: string): ToolClass {
  const n = nameRaw.toLowerCase();
  if (/(semantic|search|grep|find|list_dir|list_code|usages|lookup)/.test(n)) return 'discovery';
  if (/(read_file|read|get_errors|fetch|open|view)/.test(n)) return 'read';
  if (/(edit|replace|create|insert|apply|write|run_in_terminal|terminal|patch|new_file)/.test(n))
    return 'action';
  return 'other';
}

// ── Prompt specificity ───────────────────────────────────────────────────────
// A prompt is "specific" when it pins a concrete target the agent won't have to
// go hunting for. We count independent signals; >=1 target signal = specific.
const RE_FILE = /[\w./-]+\.(ts|tsx|js|jsx|mjs|cjs|py|md|json|css|scss|html|java|go|rs|c|cpp|h|hpp|yml|yaml|sql|sh|toml|rb|php|kt|swift)\b/i;
const RE_PATH = /(?:^|\s)(?:src|scripts|test|tests|lib|app|packages|components|docs)\/[\w./-]+/i;
const RE_BACKTICK = /`[^`]+`/;
const RE_CODEBLOCK = /```/;
const RE_SYMBOL = /\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b|\b\w+\(\)/; // camelCase or foo()
const RE_LINEREF = /\b(?:line|L)\s?\d+\b/i;

interface Specificity {
  specific: boolean;
  signals: number;
  namesFile: boolean;
}

function scoreSpecificity(prompt: string): Specificity {
  const namesFile = RE_FILE.test(prompt) || RE_PATH.test(prompt);
  const signals =
    (namesFile ? 1 : 0) +
    (RE_BACKTICK.test(prompt) ? 1 : 0) +
    (RE_CODEBLOCK.test(prompt) ? 1 : 0) +
    (RE_SYMBOL.test(prompt) ? 1 : 0) +
    (RE_LINEREF.test(prompt) ? 1 : 0);
  // "Specific" requires an actual anchor (a file/path or backticked/code target),
  // not merely a stray camelCase word.
  const specific = namesFile || RE_BACKTICK.test(prompt) || RE_CODEBLOCK.test(prompt);
  return { specific, signals, namesFile };
}

// ── Load a session's turns with real tokens aligned ──────────────────────────
interface Turn {
  prompt: string;
  spec: Specificity;
  discovery: number;
  read: number;
  action: number;
  totalCalls: number;
  promptTokens?: number;
}

function loadTurns(s: ReturnType<typeof listCopilotSessions>[number]): Turn[] | undefined {
  const parsed = parseTranscript(readText(s.transcriptPath));
  const withPrompt = parsed.turns.filter((t) => (t.promptText ?? '').trim().length > 0);
  if (withPrompt.length < MIN_TURNS) return undefined;

  let real: (TurnTokens | undefined)[] = [];
  if (s.chatSessionPath) {
    const content = readText(s.chatSessionPath);
    if (content) {
      const map = parseChatSessionTokens(content);
      real = [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    }
  }

  return withPrompt.map((t, i) => {
    let discovery = 0;
    let read = 0;
    let action = 0;
    for (const c of t.toolCalls) {
      const cls = classifyTool(c.toolName);
      if (cls === 'discovery') discovery++;
      else if (cls === 'read') read++;
      else if (cls === 'action') action++;
    }
    return {
      prompt: (t.promptText ?? '').trim(),
      spec: scoreSpecificity((t.promptText ?? '').trim()),
      discovery,
      read,
      action,
      totalCalls: t.toolCalls.length,
      promptTokens: real[i]?.promptTokens,
    };
  });
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 3) return NaN;
  const ma = mean(a);
  const mb = mean(b);
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
console.log('\n=== Tokentama — PIVOT PROBE: does prompt phrasing drive context load? ===\n');

const sessions = listCopilotSessions();
const loaded = sessions
  .map(loadTurns)
  .filter((t): t is Turn[] => Array.isArray(t))
  .sort((a, b) => b.length - a.length)
  .slice(0, N_SESSIONS);

if (loaded.length === 0) {
  console.log('No Copilot sessions with >= ' + MIN_TURNS + ' prompted turns found. Nothing to probe.');
  process.exit(0);
}

const all: Turn[] = loaded.flat();

// Class totals — this is exactly the categorisation the verdict relies on.
const clsTotals = all.reduce(
  (acc, t) => {
    acc.discovery += t.discovery;
    acc.read += t.read;
    acc.action += t.action;
    acc.total += t.totalCalls;
    return acc;
  },
  { discovery: 0, read: 0, action: 0, total: 0 },
);
const otherCalls = clsTotals.total - clsTotals.discovery - clsTotals.read - clsTotals.action;
console.log(`Corpus: ${loaded.length} sessions · ${all.length} prompted turns`);
console.log(
  `Tool calls: ${clsTotals.total} total — discovery ${clsTotals.discovery} · read ${clsTotals.read} · action ${clsTotals.action} · other ${otherCalls}`,
);
console.log(
  `Exploration tax: ${Math.round(((clsTotals.discovery + clsTotals.read) / Math.max(1, clsTotals.total)) * 100)}% of tool calls are DISCOVERY+READ (context loading, not doing work).\n`,
);

// Split specific vs vague.
const specific = all.filter((t) => t.spec.specific);
const vague = all.filter((t) => !t.spec.specific);

function block(label: string, ts: Turn[]): void {
  const withTok = ts.filter((t) => typeof t.promptTokens === 'number') as (Turn & {
    promptTokens: number;
  })[];
  console.log(`  ${label}  (${ts.length} turns, ${Math.round((ts.length / all.length) * 100)}%)`);
  console.log(`    discovery calls / turn : ${mean(ts.map((t) => t.discovery)).toFixed(2)}`);
  console.log(`    read calls / turn      : ${mean(ts.map((t) => t.read)).toFixed(2)}`);
  console.log(`    context-load / turn    : ${mean(ts.map((t) => t.discovery + t.read)).toFixed(2)} (discovery+read)`);
  console.log(`    action calls / turn    : ${mean(ts.map((t) => t.action)).toFixed(2)}`);
  if (withTok.length) {
    console.log(
      `    real promptTokens / turn: ${Math.round(mean(withTok.map((t) => t.promptTokens))).toLocaleString()}`,
    );
  }
}

console.log('--- SPECIFIC prompts (name a file / path / backticked target / code) vs VAGUE ---\n');
block('SPECIFIC', specific);
console.log('');
block('VAGUE   ', vague);

// The headline comparison.
const specLoad = mean(specific.map((t) => t.discovery + t.read));
const vagueLoad = mean(vague.map((t) => t.discovery + t.read));
const loadDeltaPct = vagueLoad > 0 ? Math.round((1 - specLoad / vagueLoad) * 100) : 0;

const specTok = specific.filter((t) => typeof t.promptTokens === 'number').map((t) => t.promptTokens!);
const vagueTok = vague.filter((t) => typeof t.promptTokens === 'number').map((t) => t.promptTokens!);
const tokDeltaPct = mean(vagueTok) > 0 ? Math.round((1 - mean(specTok) / mean(vagueTok)) * 100) : 0;

// Correlations across ALL turns: more specificity signals ↔ less context load.
const rLoad = pearson(all.map((t) => t.spec.signals), all.map((t) => t.discovery + t.read));
const withTokAll = all.filter((t) => typeof t.promptTokens === 'number');
const rTok = pearson(
  withTokAll.map((t) => t.spec.signals),
  withTokAll.map((t) => t.promptTokens!),
);

console.log('\n--- VERDICT (the pivot premise) ---');
console.log(
  `  context-load per turn: SPECIFIC ${specLoad.toFixed(2)} vs VAGUE ${vagueLoad.toFixed(2)}  →  specific loads ${loadDeltaPct}% less`,
);
if (specTok.length && vagueTok.length) {
  console.log(
    `  real promptTokens/turn: SPECIFIC ${Math.round(mean(specTok)).toLocaleString()} vs VAGUE ${Math.round(mean(vagueTok)).toLocaleString()}  →  specific is ${tokDeltaPct}% smaller`,
  );
}
console.log(`  correlation (specificity signals ↔ context-load): r = ${Number.isNaN(rLoad) ? 'n/a' : rLoad.toFixed(2)}`);
console.log(`  correlation (specificity signals ↔ promptTokens): r = ${Number.isNaN(rTok) ? 'n/a' : rTok.toFixed(2)}`);

// The addressable surface: vague prompts that triggered heavy exploration.
const heavyVague = vague.filter((t) => t.discovery + t.read >= 3);
console.log(
  `\n  addressable turns (VAGUE + >=3 context-load calls): ${heavyVague.length}/${all.length} (${Math.round((heavyVague.length / all.length) * 100)}%)` +
    ` — the prompts the feature would target.`,
);

console.log(
  '\nHow to read this: a NEGATIVE correlation and a positive "% less" mean specific prompts\n' +
    'genuinely trigger less exploration → the pivot lever is real and worth building the\n' +
    'model-based pre-send optimizer. A ~0 correlation means phrasing does NOT drive context\n' +
    'load on your data, and the pivot needs rethinking before any UI work. One dev, one\n' +
    'machine — directional, not proof; the model-prediction half is validated in-extension.\n',
);
