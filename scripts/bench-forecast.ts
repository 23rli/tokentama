/**
 * FORECAST ACCURACY harness (the "keep an accuracy score for verification" ask).
 *
 * Walks your REAL sessions and, for every turn N (N>=1), predicts the input tokens
 * from turns 0..N-1 + turn N's actual prompt text, then compares to the REAL
 * metered promptTokens[N]. Reports the accuracy of the structural forecaster vs.
 * two naive baselines, so the model choice is evidence-based, not asserted.
 *
 * All local, read-only. Run: `npm run bench:forecast`
 */
import { readFileSync } from 'node:fs';
import { listCopilotSessions } from '../src/capture/copilotPaths';
import { parseTranscript, parseChatSessionTokens, type TurnTokens } from '@tokentama/ingestion';
import {
  forecastTurn,
  forecastLastValue,
  forecastEmaDelta,
  type TurnHistory,
} from '../src/analysis/forecast';

const MIN_TURNS = 6;

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
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

  const aligned: Aligned[] = [];
  for (let i = 0; i < turns.length; i++) {
    const pt = tok[i]?.promptTokens;
    if (typeof pt !== 'number' || pt <= 0) continue;
    aligned.push({
      promptText: (turns[i].promptText ?? '').trim(),
      promptTokens: pt,
      completionTokens: tok[i]?.completionTokens,
    });
  }
  return aligned.length >= MIN_TURNS ? aligned : undefined;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface Stats {
  ape: number[]; // absolute percentage errors
  within10: number;
  within20: number;
  within30: number;
  n: number;
}

function newStats(): Stats {
  return { ape: [], within10: 0, within20: 0, within30: 0, n: 0 };
}

function record(st: Stats, predicted: number, actual: number): void {
  if (actual <= 0) return;
  const e = Math.abs(predicted - actual) / actual;
  st.ape.push(e);
  st.n++;
  if (e <= 0.1) st.within10++;
  if (e <= 0.2) st.within20++;
  if (e <= 0.3) st.within30++;
}

function report(label: string, st: Stats): void {
  const mape = st.ape.reduce((a, b) => a + b, 0) / Math.max(1, st.ape.length);
  const mdape = median(st.ape);
  const pct = (n: number): string => `${Math.round((n / Math.max(1, st.n)) * 100)}%`;
  console.log(
    `  ${label.padEnd(18)} MdAPE ${(mdape * 100).toFixed(1).padStart(5)}%  MAPE ${(mape * 100)
      .toFixed(1)
      .padStart(5)}%   within \u00b110% ${pct(st.within10).padStart(4)} \u00b120% ${pct(
      st.within20,
    ).padStart(4)} \u00b130% ${pct(st.within30).padStart(4)}   (n=${st.n})`,
  );
}

// ── Run ──────────────────────────────────────────────────────────────────────
console.log('\n=== Tokentama — FORECAST ACCURACY (predicted vs real promptTokens) ===\n');

const sessions = listCopilotSessions()
  .map(loadSession)
  .filter((a): a is Aligned[] => Array.isArray(a))
  .sort((a, b) => b.length - a.length)
  .slice(0, 10);

if (sessions.length === 0) {
  console.log('No sessions with real promptTokens found. Nothing to score.');
  process.exit(0);
}

const structural = newStats();
const lastValue = newStats();
const emaDelta = newStats();

for (const turns of sessions) {
  for (let n = 1; n < turns.length; n++) {
    const history: TurnHistory[] = turns.slice(0, n).map((t) => ({
      promptTokens: t.promptTokens,
      completionTokens: t.completionTokens,
      promptText: t.promptText,
    }));
    const draftPrompt = turns[n].promptText;
    const actual = turns[n].promptTokens;

    record(structural, forecastTurn({ history, draftPrompt }).predictedInputTokens, actual);
    record(lastValue, forecastLastValue({ history, draftPrompt }), actual);
    record(emaDelta, forecastEmaDelta({ history, draftPrompt }), actual);
  }
}

const totalTurns = sessions.reduce((a, t) => a + t.length, 0);
console.log(`Corpus: ${sessions.length} sessions · ${totalTurns} turns · ${structural.n} predictions\n`);
console.log('--- Accuracy (lower MdAPE/MAPE = better; higher within-band = better) ---');
report('STRUCTURAL', structural);
report('baseline: last-value', lastValue);
report('baseline: EMA-delta', emaDelta);

const structMd = median(structural.ape) * 100;
console.log('\n--- ACCURACY SCORE ---');
console.log(
  `  structural forecaster: MdAPE ${structMd.toFixed(1)}%  →  accuracy score ${(100 - structMd).toFixed(
    1,
  )}/100 (100 − median error), ${Math.round((structural.within20 / Math.max(1, structural.n)) * 100)}% of turns within \u00b120%.`,
);
console.log(
  '\nHow to read this: this is the number to beat and to guard. If the structural model clearly\n' +
    'beats both baselines and lands most turns within \u00b120%, the pre-send forecast is trustworthy\n' +
    'enough to show users. Re-run after any forecaster change to prevent regressions. One dev, one\n' +
    'machine \u2014 widen the corpus before publishing an accuracy claim.\n',
);
