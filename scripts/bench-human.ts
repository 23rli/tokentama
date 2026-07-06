/**
 * HUMAN-in-the-loop savings simulation. The other benchmarks measure the theoretical
 * ceiling; this one measures what a REAL person actually saves. It runs the real
 * engine (scoring, retry-risk, difficulty, offline rewrite) over realistic developer
 * sessions, then Monte-Carlo-samples human behaviour:
 *   - the human ADOPTS a suggested rewrite only some of the time,
 *   - a clearer prompt REDUCES (doesn't eliminate) the chance of a re-ask,
 *   - the human follows a right-size suggestion only some of the time,
 *   - complex tasks are never down-routed (capability preserved).
 * Output: realistic savings % with uncertainty (p10/p50/p90) across adoption rates.
 * Run: `npm run bench:human`.
 */
import { scorePrompt, estimateTokens } from '@tokentama/scoring-engine';
import { leanRewrite } from '@tokentama/llm-adapters';
import { classifyDifficulty } from '../src/analysis/taskDifficulty';
import { predictRetryRisk } from '../src/analysis/retryRisk';

// --- human-behaviour parameters (deliberately conservative) ---
const RUNS = 5000;
const ADOPTION_LEVELS = [0.3, 0.5, 0.7, 0.9]; // fraction of rewrites the human accepts
const RIGHTSIZE_FOLLOW = 0.5; // fraction of down-route suggestions the human takes
const RIGHTSIZE_SAVING = 0.35; // AICs saved on a down-routed turn
const RETRY_REDUCTION = 0.6; // a clarified prompt cuts its re-ask probability by 60%
// per-turn token model for a HUMAN chat session (smaller context than agent mode)
const CONTEXT0 = 3000;
const CONTEXT_GROWTH = 400; // context grows per turn
const REPLY = 400;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Session {
  title: string;
  turns: string[];
}

// Realistic, imperfect human prompts: some vague (retry-prone), some verbose, some
// redundant, some already specific, a few trivial. Not AI-optimal — human-natural.
const humanSessions: Session[] = [
  {
    title: 'Build a settings page',
    turns: [
      'make a settings page',
      'Could you please, if you have a moment, add a dark mode toggle to the settings page? Thanks!',
      'put it in src/pages/Settings.tsx',
      "the toggle doesn't persist",
      "Persist the dark-mode setting to localStorage under the key 'theme' and read it on load in Settings.tsx.",
      'add a language dropdown too',
      'As I said, the settings page is Settings.tsx — add a language dropdown with English, Spanish, French and store the choice in localStorage.',
      'make it look nicer',
      'Style the settings page with a two-column layout, section headings, and 16px spacing using CSS modules.',
      'add a save button',
      'write a test for the localStorage persistence',
      'rename the file to SettingsPage.tsx',
    ],
  },
  {
    title: 'Fix a failing checkout test',
    turns: [
      'the checkout test is failing',
      'still failing',
      "The test 'computes order total' in Checkout.test.tsx expects 42 but gets NaN — computeTotal returns NaN for an empty cart; return 0 instead.",
      'now the tax test fails',
      'Apply the 8.25% tax after multiplying price by quantity in computeTotal.',
      'add a test for multiple items',
      'fix it',
      'The multi-item test fails because computeTotal ignores quantity — multiply price by quantity per line item.',
      'add a currency formatter for the total',
      'document computeTotal',
    ],
  },
  {
    title: 'Refactor UserService',
    turns: [
      'So I have this UserService that is kind of a mess, you know, and I was wondering if maybe you could help clean it up somehow?',
      'Extract the DB access from UserService in src/services/UserService.ts into a UserRepository class.',
      'convert the callbacks to async await',
      'the SQL looks unsafe',
      'Replace the string-concatenated SQL in UserRepository with parameterized queries.',
      'add caching',
      'Cache getUserById for 60 seconds and invalidate it on updateUser in UserRepository.',
      "the cache isn't invalidating",
      'In updateUser, delete the cache entry for that id after the write.',
      'add logging to each repository method',
      'split UserService into two classes',
      'remove unused imports',
    ],
  },
];

interface TurnSig {
  promptTok: number;
  rewriteTok: number;
  compressible: boolean;
  risk: number; // 0..1 base re-ask probability (from the engine)
  retryProne: boolean;
  nonComplex: boolean;
}

function analyze(text: string): TurnSig {
  const resp = scorePrompt({ sessionId: 'sim', userId: 'u', promptText: text });
  const risk = predictRetryRisk({
    wasteBreakdown: resp.wasteBreakdown,
    overallScore: resp.overallScore,
  }).risk;
  const promptTok = estimateTokens(text);
  const rw = leanRewrite(text).trim();
  const rewriteTok =
    rw !== text.trim() && rw.length < text.trim().length ? estimateTokens(rw) : promptTok;
  return {
    promptTok,
    rewriteTok,
    compressible: rewriteTok < promptTok,
    risk,
    retryProne: risk >= 0.3,
    nonComplex: classifyDifficulty(text).level !== 'complex',
  };
}

const analyzed = humanSessions.map((s) => ({ title: s.title, turns: s.turns.map(analyze) }));

type SimMode = 'full' | 'retryOnly' | 'rightsizeOnly' | 'compressOnly';

function simulate(adopt: number, rng: () => number, mode: SimMode = 'full'): { base: number; treat: number } {
  let base = 0;
  let treat = 0;
  for (const s of analyzed) {
    for (let i = 0; i < s.turns.length; i++) {
      const t = s.turns[i];
      const context = CONTEXT0 + i * CONTEXT_GROWTH;
      const turnCost = (promptTok: number): number => context + promptTok + REPLY;

      // Baseline: natural prompt, natural re-ask behaviour.
      base += turnCost(t.promptTok);
      if (rng() < t.risk) base += turnCost(t.promptTok);

      // Treatment: the human uses the extension.
      const adopted = rng() < adopt;
      const useCompress = (mode === 'full' || mode === 'compressOnly') && adopted && t.compressible;
      const useRetry = mode === 'full' || mode === 'retryOnly';
      const useRightsize = mode === 'full' || mode === 'rightsizeOnly';

      const tPromptTok = useCompress ? t.rewriteTok : t.promptTok;
      const tRisk = useRetry && adopted && t.retryProne ? t.risk * (1 - RETRY_REDUCTION) : t.risk;

      let cost = turnCost(tPromptTok);
      if (rng() < tRisk) cost += turnCost(tPromptTok);
      // Right-sizing: down-route a non-complex turn if the human follows (capability-safe).
      if (useRightsize && t.nonComplex && rng() < RIGHTSIZE_FOLLOW) cost *= 1 - RIGHTSIZE_SAVING;
      treat += cost;
    }
  }
  return { base, treat };
}

function pctile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function meanSavings(
  adopt: number,
  mode: SimMode = 'full',
): { mean: number; p10: number; p50: number; p90: number } {
  const rng = mulberry32(1234 + Math.round(adopt * 100) + mode.length);
  const savings: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const { base, treat } = simulate(adopt, rng, mode);
    savings.push(base > 0 ? (1 - treat / base) * 100 : 0);
  }
  return {
    mean: savings.reduce((a, b) => a + b, 0) / savings.length,
    p10: pctile(savings, 0.1),
    p50: pctile(savings, 0.5),
    p90: pctile(savings, 0.9),
  };
}

const totalTurns = analyzed.reduce((n, s) => n + s.turns.length, 0);
const retryProne = analyzed.reduce((n, s) => n + s.turns.filter((t) => t.retryProne).length, 0);
const nonComplex = analyzed.reduce((n, s) => n + s.turns.filter((t) => t.nonComplex).length, 0);

console.log('\n=== Tokentama — HUMAN-in-the-loop savings simulation ===\n');
console.log(
  `${humanSessions.length} realistic sessions · ${totalTurns} turns · ${retryProne} retry-prone · ` +
    `${nonComplex} non-complex (down-routable) · ${RUNS.toLocaleString()} Monte-Carlo runs each\n`,
);

console.log('Savings a real human gets, by how often they ACCEPT suggestions:');
console.log('  adoption   mean    p10–p90 (spread across runs)');
for (const a of ADOPTION_LEVELS) {
  const r = meanSavings(a);
  console.log(
    `   ${Math.round(a * 100)}%       ${r.mean.toFixed(1)}%    ${r.p10.toFixed(1)}%–${r.p90.toFixed(1)}%`,
  );
}

console.log('\nWhere the savings come from (isolated, at 60% adoption):');
for (const [label, mode] of [
  ['retry-avoidance', 'retryOnly'],
  ['right-sizing    ', 'rightsizeOnly'],
  ['compression     ', 'compressOnly'],
] as [string, SimMode][]) {
  console.log(`  ${label}  ${meanSavings(0.6, mode).mean.toFixed(1)}%`);
}

console.log(
  '\nHow to read this: these are HUMAN numbers — they already discount for the fact that\n' +
    'people ignore some suggestions, that a clearer prompt only REDUCES re-asks, and that\n' +
    'complex tasks are never down-routed. No context is dropped (compaction excluded). The\n' +
    'per-turn token model is a typical human chat session; the RELATIVE savings are what\n' +
    'matter. Adoption is the biggest driver — the tool is only as good as it is usable.\n',
);
