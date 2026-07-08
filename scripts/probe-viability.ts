/**
 * VIABILITY PROBE — the size-controlled version of the pivot test.
 *
 * The first probe (probe-context.ts) was confounded: "specific" prompts were just
 * BIGGER tasks, so they read more. This probe removes that confound by using the
 * tool ARGUMENTS (file paths) captured in `tool.execution_start` events, and asks
 * the sharp question:
 *
 *   For tasks of the SAME footprint (same number of files touched), does the
 *   prompt NAMING the target file eliminate the agent's HUNTING (discovery calls:
 *   semantic_search / grep / file_search / list_dir)?
 *
 * If naming the target cuts discovery at equal footprint, a model-based pre-send
 * optimizer that adds "the file is X" is a REAL lever. If discovery is the same
 * whether or not the prompt named the file, the pivot is not viable and we stop.
 *
 * All local, read-only. Run: `npm run probe:viability`
 */
import { readFileSync } from 'node:fs';
import { listCopilotSessions } from '../src/capture/copilotPaths';
import { parseChatSessionTokens, type TurnTokens } from '@tokentama/ingestion';

const MIN_TURNS = 8;

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
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

// Any string that looks like a source file, reduced to its basename (so a prompt
// saying "extension.ts" matches a tool touching "src/extension.ts").
const RE_FILELIKE = /[\w./\\-]+\.(ts|tsx|js|jsx|mjs|cjs|py|md|json|css|scss|html|java|go|rs|c|cpp|h|hpp|yml|yaml|sql|sh|toml|rb|php|kt|swift)\b/gi;

function basenames(text: string): Set<string> {
  const out = new Set<string>();
  const matches = text.match(RE_FILELIKE) ?? [];
  for (const m of matches) {
    const base = m.replace(/\\/g, '/').split('/').pop();
    if (base) out.add(base.toLowerCase());
  }
  return out;
}

// Walk a tool-call arguments object and collect any file basenames it references.
function argPaths(args: unknown): Set<string> {
  const out = new Set<string>();
  const visit = (v: unknown): void => {
    if (typeof v === 'string') {
      for (const b of basenames(v)) out.add(b);
    } else if (Array.isArray(v)) {
      v.forEach(visit);
    } else if (v && typeof v === 'object') {
      Object.values(v as Record<string, unknown>).forEach(visit);
    }
  };
  visit(args);
  return out;
}

interface Turn {
  prompt: string;
  discovery: number;
  read: number;
  action: number;
  touched: Set<string>; // files read/edited this turn
  namedTouched: boolean; // prompt named >=1 file that was touched
  promptNamedAny: boolean; // prompt named any file at all
  promptTokens?: number;
}

interface RawEv {
  type?: string;
  data?: Record<string, any>;
  timestamp?: string;
}

function loadTurns(transcriptPath: string, chatSessionPath?: string): Turn[] | undefined {
  const content = readText(transcriptPath);
  if (!content) return undefined;
  const lines = content.split(/\r?\n/).filter((l) => l.trim());

  let real: (TurnTokens | undefined)[] = [];
  if (chatSessionPath) {
    const c = readText(chatSessionPath);
    if (c) real = [...parseChatSessionTokens(c).entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }

  const turns: Turn[] = [];
  let cur: Turn | undefined;
  let promptIdx = -1;

  const newTurn = (prompt: string): Turn => ({
    prompt,
    discovery: 0,
    read: 0,
    action: 0,
    touched: new Set(),
    namedTouched: false,
    promptNamedAny: false,
    promptTokens: undefined,
  });

  for (const line of lines) {
    let ev: RawEv;
    try {
      ev = JSON.parse(line) as RawEv;
    } catch {
      continue;
    }
    const d = ev.data ?? {};
    if (ev.type === 'user.message') {
      cur = newTurn(typeof d.content === 'string' ? d.content : '');
      promptIdx++;
      cur.promptTokens = real[promptIdx]?.promptTokens;
      cur.promptNamedAny = basenames(cur.prompt).size > 0;
      turns.push(cur);
    } else if (ev.type === 'tool.execution_start' && cur) {
      const name = typeof d.toolName === 'string' ? d.toolName : 'unknown';
      const cls = classifyTool(name);
      if (cls === 'discovery') cur.discovery++;
      else if (cls === 'read') cur.read++;
      else if (cls === 'action') cur.action++;
      if (cls === 'read' || cls === 'action') {
        for (const b of argPaths(d.arguments)) cur.touched.add(b);
      }
    }
  }

  // Resolve "did the prompt name a file that was actually touched?"
  const named = turns.map((t) => {
    const promptFiles = basenames(t.prompt);
    for (const f of t.touched) if (promptFiles.has(f)) return { ...t, namedTouched: true };
    return t;
  });

  return named.filter((t) => t.prompt.trim().length > 0).length >= MIN_TURNS ? named : undefined;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

// ── Run ──────────────────────────────────────────────────────────────────────
console.log('\n=== Tokentama — VIABILITY PROBE (size-controlled) ===\n');

const loaded = listCopilotSessions()
  .map((s) => loadTurns(s.transcriptPath, s.chatSessionPath))
  .filter((t): t is Turn[] => Array.isArray(t))
  .sort((a, b) => b.length - a.length)
  .slice(0, 10);

const all = loaded.flat().filter((t) => t.prompt.trim().length > 0);
if (all.length === 0) {
  console.log('No sessions with tool-argument data found. Nothing to probe.');
  process.exit(0);
}

console.log(`Corpus: ${loaded.length} sessions · ${all.length} prompted turns (with tool args)\n`);

// Footprint = distinct files the turn actually touched (read or edited).
const footprint = (t: Turn): number => t.touched.size;
const worked = all.filter((t) => footprint(t) >= 1); // turns that actually touched files

console.log(
  `Turns that touched >=1 file: ${worked.length}/${all.length}. ` +
    `Of those, prompt named a touched file in ${worked.filter((t) => t.namedTouched).length} (${Math.round(
      (worked.filter((t) => t.namedTouched).length / Math.max(1, worked.length)) * 100,
    )}%).\n`,
);

// The size-controlled comparison: within each footprint bucket, compare discovery
// calls for "prompt named the target" vs "prompt did not".
const buckets: [string, (n: number) => boolean][] = [
  ['1 file  ', (n) => n === 1],
  ['2-3 files', (n) => n >= 2 && n <= 3],
  ['4-6 files', (n) => n >= 4 && n <= 6],
  ['7+ files ', (n) => n >= 7],
];

console.log('--- Discovery (hunting) calls per turn, at EQUAL footprint ---');
console.log('  footprint   named-target   not-named    Δ (named vs not)   n(named)/n(not)');
let totalNamedDisc = 0;
let totalNotDisc = 0;
let nNamed = 0;
let nNot = 0;
for (const [label, pred] of buckets) {
  const inB = worked.filter((t) => pred(footprint(t)));
  const named = inB.filter((t) => t.namedTouched);
  const not = inB.filter((t) => !t.namedTouched);
  const dN = mean(named.map((t) => t.discovery));
  const dNot = mean(not.map((t) => t.discovery));
  totalNamedDisc += named.reduce((a, t) => a + t.discovery, 0);
  totalNotDisc += not.reduce((a, t) => a + t.discovery, 0);
  nNamed += named.length;
  nNot += not.length;
  const delta = dNot > 0 ? `${Math.round((1 - dN / dNot) * 100)}% fewer` : 'n/a';
  console.log(
    `  ${label}   ${dN.toFixed(2)}          ${dNot.toFixed(2)}        ${delta.padEnd(14)}    ${named.length}/${not.length}`,
  );
}

const overallNamed = nNamed ? totalNamedDisc / nNamed : 0;
const overallNot = nNot ? totalNotDisc / nNot : 0;
const viabilityPct = overallNot > 0 ? Math.round((1 - overallNamed / overallNot) * 100) : 0;

console.log('\n--- VERDICT (viability of the pivot lever) ---');
console.log(
  `  discovery/turn overall: named-target ${overallNamed.toFixed(2)} vs not-named ${overallNot.toFixed(2)}  →  naming cuts hunting by ${viabilityPct}%`,
);
console.log(
  `  recoverable slice: discovery calls are ${all.reduce((a, t) => a + t.discovery, 0)} of ${all.reduce(
    (a, t) => a + t.discovery + t.read + t.action,
    0,
  )} tool calls (${Math.round(
    (all.reduce((a, t) => a + t.discovery, 0) /
      Math.max(1, all.reduce((a, t) => a + t.discovery + t.read + t.action, 0))) *
      100,
  )}%) — the ceiling for this lever.`,
);

console.log(
  '\nHow to read this: if "named-target" turns have MEANINGFULLY fewer discovery calls at the\n' +
    'SAME footprint (a solid positive Δ across buckets), then adding the target file to a prompt\n' +
    'really does stop the agent hunting → the pivot lever is VIABLE and worth a model-based\n' +
    'optimizer. If Δ ~ 0, naming the file does NOT reduce hunting and the lever is not viable.\n' +
    'The "recoverable slice" caps how much even a perfect version could ever save. One dev, one\n' +
    'machine — directional.\n',
);
