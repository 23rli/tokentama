/**
 * FORECAST LAB — deep diagnostics to push the prediction toward "right every time".
 *
 * Answers three things the quick harness (bench-forecast) doesn't:
 *   1) WHERE the error lives — segments each turn (steady / surge / reset) and
 *      reports point accuracy per segment, so we know which turns are hard and
 *      how common they are.
 *   2) CALIBRATION — treats the forecast as an INTERVAL [low, high] and measures
 *      real coverage (does the actual land inside as often as we claim?). A
 *      calibrated interval is the honest form of "accurate every time".
 *   3) COST — the forecaster is pure local arithmetic (0 tokens); this times it
 *      and states the token-to-result ratio explicitly.
 *
 * Local, read-only. Run: `npm run bench:forecast:lab`
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { listCopilotSessions } from '../src/capture/copilotPaths';
import { parseTranscript, parseChatSessionTokens, type TurnTokens } from '@tokentama/ingestion';
import { forecastTurn, type TurnHistory } from '../src/analysis/forecast';

const MIN_TURNS = 6;

function readText(p: string): string {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

interface Aligned {
  promptText: string;
  promptTokens: number;
  completionTokens?: number;
}

function loadSession(s: ReturnType<typeof listCopilotSessions>[number]): Aligned[] | undefined {
  const parsed = parseTranscript(readText(s.transcriptPath));
  const turns = parsed.turns.filter((t) => (t.promptText ?? '').trim().length > 0);
  if (turns.length < MIN_TURNS || !s.chatSessionPath) return undefined;
  const content = readText(s.chatSessionPath);
  if (!content) return undefined;
  const tok: (TurnTokens | undefined)[] = [...parseChatSessionTokens(content).entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
  const out: Aligned[] = [];
  for (let i = 0; i < turns.length; i++) {
    const pt = tok[i]?.promptTokens;
    if (typeof pt !== 'number' || pt <= 0) continue;
    out.push({
      promptText: (turns[i].promptText ?? '').trim(),
      promptTokens: pt,
      completionTokens: tok[i]?.completionTokens,
    });
  }
  return out.length >= MIN_TURNS ? out : undefined;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}
const median = (xs: number[]): number => quantile([...xs].sort((a, b) => a - b), 0.5);

type Segment = 'steady' | 'surge' | 'reset';
function segmentOf(prev: number, actual: number): Segment {
  const r = actual / prev;
  if (r > 1.15) return 'surge';
  if (r < 0.85) return 'reset';
  return 'steady';
}

// ── Run ──────────────────────────────────────────────────────────────────────
console.log('\n=== Tokentama — FORECAST LAB (segments · calibration · cost) ===\n');

const sessions = listCopilotSessions()
  .map(loadSession)
  .filter((a): a is Aligned[] => Array.isArray(a))
  .sort((a, b) => b.length - a.length)
  .slice(0, 12);

if (sessions.length === 0) {
  console.log('No sessions with real promptTokens found.');
  process.exit(0);
}

interface Row {
  seg: Segment;
  prev: number;
  actual: number;
  predicted: number;
  ratio: number; // actual / predicted
  ape: number;
  confidence: number;
  intervalLow: number;
  intervalHigh: number;
  resetRisk: 'low' | 'high';
}

const rows: Row[] = [];
let timeNs = 0;
for (const turns of sessions) {
  for (let n = 1; n < turns.length; n++) {
    const history: TurnHistory[] = turns.slice(0, n).map((t) => ({
      promptTokens: t.promptTokens,
      completionTokens: t.completionTokens,
      promptText: t.promptText,
    }));
    const t0 = performance.now();
    const f = forecastTurn({ history, draftPrompt: turns[n].promptText });
    timeNs += (performance.now() - t0) * 1e6;
    const actual = turns[n].promptTokens;
    const prev = turns[n - 1].promptTokens;
    rows.push({
      seg: segmentOf(prev, actual),
      prev,
      actual,
      predicted: f.predictedInputTokens,
      ratio: actual / Math.max(1, f.predictedInputTokens),
      ape: Math.abs(f.predictedInputTokens - actual) / actual,
      confidence: f.confidence,
      intervalLow: f.interval.low,
      intervalHigh: f.interval.high,
      resetRisk: f.resetRisk,
    });
  }
}

console.log(`Corpus: ${sessions.length} sessions · ${rows.length} predictions\n`);

// 1) SEGMENTS
console.log('--- 1) Where the error lives (by turn type) ---');
for (const seg of ['steady', 'surge', 'reset'] as Segment[]) {
  const r = rows.filter((x) => x.seg === seg);
  const share = Math.round((r.length / rows.length) * 100);
  const md = median(r.map((x) => x.ape)) * 100;
  const within20 = Math.round((r.filter((x) => x.ape <= 0.2).length / Math.max(1, r.length)) * 100);
  console.log(
    `  ${seg.padEnd(7)} ${String(share).padStart(3)}% of turns   MdAPE ${md.toFixed(1).padStart(6)}%   within \u00b120% ${String(within20).padStart(3)}%   (n=${r.length})`,
  );
}
console.log('');

// 1b) RESET FLAG — does the flag catch the resets? (the honest handling)
console.log('--- 1b) Reset-risk flag vs. actual resets (does it catch them?) ---');
const resets = rows.filter((x) => x.seg === 'reset');
const flagged = rows.filter((x) => x.resetRisk === 'high');
const resetsFlagged = resets.filter((x) => x.resetRisk === 'high');
const flaggedNonReset = flagged.filter((x) => x.seg !== 'reset');
console.log(
  `  resets caught by flag: ${resetsFlagged.length}/${resets.length}   ·   turns flagged total: ${flagged.length}   ·   false alarms (flagged, not a reset): ${flaggedNonReset.length}`,
);
console.log(
  `  → flagged turns receive a possible-reset warning. Recall and false alarms above determine whether that signal is reliable.\n`,
);

// Point accuracy EXCLUDING flagged turns (what the user actually sees as a number).
const shown = rows.filter((x) => x.resetRisk === 'low');
const shownMd = median(shown.map((x) => x.ape)) * 100;
const shownW20 = Math.round((shown.filter((x) => x.ape <= 0.2).length / Math.max(1, shown.length)) * 100);
console.log('--- 1c) Point accuracy with flagged turns excluded (not all resets are caught) ---');
console.log(
  `  shown turns: ${shown.length}/${rows.length}   MdAPE ${shownMd.toFixed(1)}%   within \u00b120% ${shownW20}%\n`,
);

// 2) CALIBRATION — coverage of the forecaster's OWN emitted interval.
const inInterval = rows.filter((x) => x.actual >= x.intervalLow && x.actual <= x.intervalHigh);
const inIntervalShown = shown.filter((x) => x.actual >= x.intervalLow && x.actual <= x.intervalHigh);
console.log('--- 2) Calibration — coverage of the emitted [low, high] interval ---');
console.log(
  `  interval contains the actual: ${Math.round((inInterval.length / rows.length) * 100)}% of ALL turns   ·   ${Math.round(
    (inIntervalShown.length / Math.max(1, shown.length)) * 100,
  )}% of shown turns.`,
);
const ratios = rows.map((x) => x.ratio).sort((a, b) => a - b);
console.log(
  `  ratio quantiles (actual/predicted): p05 ${quantile(ratios, 0.05).toFixed(2)} · p50 ${quantile(ratios, 0.5).toFixed(
    2,
  )} · p95 ${quantile(ratios, 0.95).toFixed(2)}\n`,
);

// 3) COST
const perPredUs = timeNs / 1e3 / rows.length;
console.log('--- 3) Cost of running the prediction (token-to-result ratio) ---');
console.log(`  model calls: 0   ·   tokens spent: 0   ·   PURE LOCAL ARITHMETIC.`);
console.log(`  compute: ${perPredUs.toFixed(1)} µs/prediction (${(timeNs / 1e6).toFixed(1)} ms for all ${rows.length}).`);
console.log(`  token-to-result ratio: 0 tokens → ${(100 - shownMd).toFixed(1)}/100 accuracy on shown turns. Free.\n`);

// Worst misses among unflagged turns. Some resets may remain because the risk
// detector is an experimental proximity signal, not a reliable classifier.
const worst = [...shown].sort((a, b) => b.ape - a.ape).slice(0, 6);
console.log('--- Worst 6 misses among UNFLAGGED turns ---');
for (const w of worst) {
  console.log(
    `  ${w.seg.padEnd(6)} prev ${w.prev.toLocaleString().padStart(9)} → actual ${w.actual
      .toLocaleString()
      .padStart(9)}   predicted ${w.predicted.toLocaleString().padStart(9)}   APE ${(w.ape * 100).toFixed(0)}%   conf ${w.confidence.toFixed(2)}`,
  );
}
console.log(
  `\nHow to read this: steady-turn accuracy is strong, but resets remain an unpredictable failure\n` +
    `mode. The current risk flag caught ${resetsFlagged.length}/${resets.length} resets and produced ${flaggedNonReset.length} false alarms, so do NOT sell it as reliable prediction. ` +
    'Use the interval/confidence as the primary uncertainty signal. Cost is zero. Widen the\n' +
    'corpus before any published accuracy claim.\n',
);
