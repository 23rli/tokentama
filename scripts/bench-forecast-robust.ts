/**
 * ROBUSTNESS harness — "is the forecaster fragile across models?"
 *
 * Concern: it was validated on ONE setup (Claude Opus, ~1M context). Other people
 * use Auto, smaller-window models, different tokenizers. This stress-tests it by
 * transforming the real sessions into synthetic "other-model" regimes and checks
 * that the SELF-CALIBRATING forecaster stays accurate where a STATIC one (old
 * hardcoded interval + absolute 60k reset threshold) breaks.
 *
 * Regimes (applied to real sessions):
 *   - identity         : your data as-is.
 *   - small-window     : ×0.15 tokens + ×0.15 model limit (simulate a ~128k model).
 *   - large-window     : ×2.0 tokens + ×2.0 model limit.
 *   - different-tokenizer: ×0.7 tokens (same window) — a leaner tokenizer.
 *   - volatile-harness : inject erratic per-turn growth noise (a jumpier agent).
 *
 * The point model is scale-covariant (it uses real metered tokens), so the test
 * is really about the INTERVAL and the RESET flag adapting. Local, read-only.
 * Run: `npm run bench:forecast:robust`
 */
import { readFileSync } from 'node:fs';
import { listCopilotSessions } from '../src/capture/copilotPaths';
import {
  parseTranscript,
  parseChatSession,
  parseChatSessionTokens,
  type TurnTokens,
} from '@tokentama/ingestion';
import { forecastTurn, type TurnHistory } from '../src/analysis/forecast';

const MIN_TURNS = 6;
const STATIC_INTERVAL_LOW = 0.77;
const STATIC_INTERVAL_HIGH = 1.21;
const STATIC_RESET_ABS = 60_000; // the old hardcoded ceiling — fragile on purpose

function readText(p: string): string {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

interface Turn {
  promptText: string;
  promptTokens: number;
  completionTokens?: number;
}
interface Session {
  turns: Turn[];
  maxInputTokens?: number;
}

function loadSession(s: ReturnType<typeof listCopilotSessions>[number]): Session | undefined {
  const parsed = parseTranscript(readText(s.transcriptPath));
  const tt = parsed.turns.filter((t) => (t.promptText ?? '').trim().length > 0);
  if (tt.length < MIN_TURNS || !s.chatSessionPath) return undefined;
  const content = readText(s.chatSessionPath);
  if (!content) return undefined;
  const tok: (TurnTokens | undefined)[] = [...parseChatSessionTokens(content).entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
  const model = parseChatSession(content).model;
  const turns: Turn[] = [];
  for (let i = 0; i < tt.length; i++) {
    const pt = tok[i]?.promptTokens;
    if (typeof pt !== 'number' || pt <= 0) continue;
    turns.push({
      promptText: (tt[i].promptText ?? '').trim(),
      promptTokens: pt,
      completionTokens: tok[i]?.completionTokens,
    });
  }
  return turns.length >= MIN_TURNS ? { turns, maxInputTokens: model?.maxInputTokens } : undefined;
}

// Deterministic PRNG so regimes are reproducible.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Regime = { name: string; scale: number; limitScale: number; volatility: number };
const REGIMES: Regime[] = [
  { name: 'identity', scale: 1, limitScale: 1, volatility: 0 },
  { name: 'small-window ×0.15', scale: 0.15, limitScale: 0.15, volatility: 0 },
  { name: 'large-window ×2.0', scale: 2.0, limitScale: 2.0, volatility: 0 },
  { name: 'diff-tokenizer ×0.7', scale: 0.7, limitScale: 1, volatility: 0 },
  { name: 'volatile-harness', scale: 1, limitScale: 1, volatility: 0.35 },
];

function applyRegime(session: Session, r: Regime): Session {
  const rnd = mulberry32(1234);
  const turns = session.turns.map((t) => {
    const noise = r.volatility > 0 ? 1 + (rnd() * 2 - 1) * r.volatility : 1;
    return {
      promptText: t.promptText,
      promptTokens: Math.max(1, Math.round(t.promptTokens * r.scale * noise)),
      completionTokens:
        t.completionTokens != null ? Math.max(0, Math.round(t.completionTokens * r.scale * noise)) : undefined,
    };
  });
  const maxInputTokens =
    session.maxInputTokens != null ? Math.round(session.maxInputTokens * r.limitScale) : undefined;
  return { turns, maxInputTokens };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface Acc {
  shownApe: number[];
  covIn: number;
  covN: number;
  flagged: number;
  total: number;
}
function newAcc(): Acc {
  return { shownApe: [], covIn: 0, covN: 0, flagged: 0, total: 0 };
}

// ── Run ──────────────────────────────────────────────────────────────────────
console.log('\n=== Tokentama — FORECAST ROBUSTNESS (adaptive vs static across model regimes) ===\n');

const sessions = listCopilotSessions()
  .map(loadSession)
  .filter((s): s is Session => !!s)
  .sort((a, b) => b.turns.length - a.turns.length)
  .slice(0, 12);

if (sessions.length === 0) {
  console.log('No sessions found.');
  process.exit(0);
}
console.log(
  `Corpus: ${sessions.length} sessions · model maxInputTokens (identity): ${
    sessions[0].maxInputTokens?.toLocaleString() ?? 'unknown'
  }\n`,
);

console.log('regime                 │ ADAPTIVE (self-calibrating)      │ STATIC (fixed 0.77/1.21 + 60k reset)');
console.log('                       │ shownMdAPE  cover  flagged       │ shownMdAPE  cover  flagged');
console.log('───────────────────────┼──────────────────────────────────┼────────────────────────────────────');

for (const regime of REGIMES) {
  const adapt = newAcc();
  const stat = newAcc();

  for (const base of sessions) {
    const session = applyRegime(base, regime);
    const turns = session.turns;
    for (let n = 1; n < turns.length; n++) {
      const history: TurnHistory[] = turns.slice(0, n).map((t) => ({
        promptTokens: t.promptTokens,
        completionTokens: t.completionTokens,
        promptText: t.promptText,
      }));
      const actual = turns[n].promptTokens;
      const draftPrompt = turns[n].promptText;

      // ADAPTIVE — full forecaster, model limit threaded.
      const f = forecastTurn({ history, draftPrompt, model: { maxInputTokens: session.maxInputTokens } });
      adapt.total++;
      if (f.resetRisk === 'high') {
        adapt.flagged++;
      } else {
        adapt.shownApe.push(Math.abs(f.predictedInputTokens - actual) / actual);
        adapt.covN++;
        if (actual >= f.interval.low && actual <= f.interval.high) adapt.covIn++;
      }

      // STATIC — same point, but fixed interval + absolute reset threshold.
      const point = f.predictedInputTokens;
      const sLow = Math.round(point * STATIC_INTERVAL_LOW);
      const sHigh = Math.round(point * STATIC_INTERVAL_HIGH);
      const sFlag = point >= STATIC_RESET_ABS;
      stat.total++;
      if (sFlag) {
        stat.flagged++;
      } else {
        stat.shownApe.push(Math.abs(point - actual) / actual);
        stat.covN++;
        if (actual >= sLow && actual <= sHigh) stat.covIn++;
      }
    }
  }

  const fmt = (a: Acc): string => {
    const md = (median(a.shownApe) * 100).toFixed(1) + '%';
    const cov = a.covN ? Math.round((a.covIn / a.covN) * 100) + '%' : 'n/a';
    const flag = Math.round((a.flagged / Math.max(1, a.total)) * 100) + '%';
    return `${md.padStart(9)}  ${cov.padStart(5)}  ${flag.padStart(6)}`;
  };
  console.log(`${regime.name.padEnd(22)} │ ${fmt(adapt)}       │ ${fmt(stat)}`);
}

console.log(
  '\nHow to read this: the ADAPTIVE columns should stay roughly CONSTANT across every regime\n' +
    '(shownMdAPE low, coverage ~90%, flagged a small sane %). The STATIC columns should BREAK:\n' +
    '  · under small-window its 60k reset threshold stops firing (flagged→0%, resets leak into\n' +
    '    the shown number, MdAPE blows up);\n' +
    '  · under large-window/scaled-up it flags almost everything (flagged→~100%, nothing shown);\n' +
    '  · under volatile-harness its fixed 0.77/1.21 band loses coverage.\n' +
    'That contrast is the evidence that the self-calibrating version is NOT fragile across models.\n' +
    'Still one dev\u2019s sessions transformed — real multi-user data is the final proof.\n',
);
