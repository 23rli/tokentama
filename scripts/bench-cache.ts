/**
 * CACHE-EFFICIENCY analysis on real Copilot history. The biggest structural cost is
 * re-sent context; whether that's cheap depends on prompt CACHING. We can't read a
 * cache flag directly, but each metered turn carries the full `promptTokens` (input)
 * and the real billed `copilotCredits`. Subtracting the estimated OUTPUT cost leaves
 * the INPUT cost, and dividing by promptTokens gives the EFFECTIVE input rate. Compare
 * that to the model's full input rate vs a ~10% cache-read rate to infer how much of
 * your input was a cache hit — and how much you paid full price for (recoverable waste).
 *
 * Everything local. Run: `npm run bench:cache`.
 */
import { readFileSync } from 'node:fs';
import { listCopilotSessions } from '../src/capture/copilotPaths';
import { parseChatSession, parseChatSessionTokens } from '@tokentama/ingestion';
import { resolvePricing } from '@tokentama/scoring-engine';

const CACHE_RATIO = 0.1; // cache reads ~10% of the fresh input rate
const MIN_METERED = 8;
const N_SESSIONS = 5;

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

interface TurnRate {
  promptTok: number;
  effRate: number; // effective input AIC / 1M tokens
  hitFrac: number; // 0 = full price, 1 = fully cached
  inCredit: number;
  wasteVsCached: number; // extra AIC paid vs a perfect cache hit
}

interface CacheSession {
  id: string;
  turns: TurnRate[];
  billed: number;
  inRate: number;
  cachedRate: number;
}

function load(s: ReturnType<typeof listCopilotSessions>[number]): CacheSession | undefined {
  if (!s.chatSessionPath) return undefined;
  const content = readText(s.chatSessionPath);
  if (!content) return undefined;
  const map = parseChatSessionTokens(content);
  const model = parseChatSession(content).model;
  const family = model?.family;
  const inRate = model?.inputPer1M ?? resolvePricing(family).inputUsdPerMillion * 1000;
  const outRate = model?.outputPer1M ?? resolvePricing(family).outputUsdPerMillion * 1000;
  const cachedRate = inRate * CACHE_RATIO;

  const turns: TurnRate[] = [];
  let billed = 0;
  for (const t of map.values()) {
    const promptTok = t.promptTokens ?? 0;
    const credit = t.copilotCredits ?? 0;
    if (promptTok <= 0 || credit <= 0) continue;
    const estOut = ((t.completionTokens ?? 0) * outRate) / 1_000_000;
    const inCredit = Math.max(0, credit - estOut);
    const effRate = (inCredit / promptTok) * 1_000_000;
    const hitFrac = Math.max(0, Math.min(1, (inRate - effRate) / (inRate - cachedRate)));
    const wasteVsCached = Math.max(0, inCredit - (promptTok * cachedRate) / 1_000_000);
    turns.push({ promptTok, effRate, hitFrac, inCredit, wasteVsCached });
    billed += credit;
  }
  if (turns.length < MIN_METERED) return undefined;
  return { id: s.sessionId.slice(0, 8), turns, billed, inRate, cachedRate };
}

const sessions = listCopilotSessions()
  .map(load)
  .filter((x): x is CacheSession => x != null)
  .sort((a, b) => b.turns.length - a.turns.length)
  .slice(0, N_SESSIONS);

console.log('\n=== Tokentama — cache-efficiency analysis (real history) ===\n');

if (sessions.length === 0) {
  console.log('No metered Copilot sessions found (need on-disk copilotCredits + promptTokens).\n');
} else {
  let gBilled = 0;
  let gInCredit = 0;
  let gWaste = 0;
  let gTurns = 0;
  let gHitWeighted = 0;

  for (const s of sessions) {
    const inCredit = s.turns.reduce((a, t) => a + t.inCredit, 0);
    const waste = s.turns.reduce((a, t) => a + t.wasteVsCached, 0);
    const avgEff = s.turns.reduce((a, t) => a + t.effRate, 0) / s.turns.length;
    // token-weighted cache-hit fraction
    const totTok = s.turns.reduce((a, t) => a + t.promptTok, 0);
    const hitW = s.turns.reduce((a, t) => a + t.hitFrac * t.promptTok, 0) / (totTok || 1);
    const fullPriceTurns = s.turns.filter((t) => t.hitFrac < 0.25).length;

    gBilled += s.billed;
    gInCredit += inCredit;
    gWaste += waste;
    gTurns += s.turns.length;
    gHitWeighted += hitW * totTok;

    console.log(`• session ${s.id}…  (${s.turns.length} metered turns)`);
    console.log(
      `  input rate: full ${s.inRate.toFixed(0)} · cached ${s.cachedRate.toFixed(0)} · ` +
        `EFFECTIVE ${avgEff.toFixed(0)} AIC/1M  →  ~${Math.round(hitW * 100)}% of input looks cached`,
    );
    console.log(
      `  full-price turns (barely cached): ${fullPriceTurns}/${s.turns.length}  ·  ` +
        `waste vs perfect cache: ${waste.toFixed(0)} AIC of ${inCredit.toFixed(0)} input AIC`,
    );
    console.log('');
  }

  const gTotTok = sessions.reduce((a, s) => a + s.turns.reduce((b, t) => b + t.promptTok, 0), 0);
  console.log('--- Across all sessions ---');
  console.log(
    `billed: ${gBilled.toFixed(0)} AIC · input portion: ${gInCredit.toFixed(0)} AIC (${Math.round(
      (gInCredit / (gBilled || 1)) * 100,
    )}% of the bill is INPUT/context)`,
  );
  console.log(`token-weighted cache-hit: ~${Math.round((gHitWeighted / (gTotTok || 1)) * 100)}% of input`);
  console.log(
    `cache-miss waste (recoverable if fully cached): ${gWaste.toFixed(0)} AIC (${Math.round(
      (gWaste / (gBilled || 1)) * 100,
    )}% of total bill)`,
  );
  console.log(
    '\nHow to read this: this INFERS caching from billed credits vs full input tokens (no direct\n' +
      'cache flag exists on disk), assuming the model\'s published input rate and a ~10% cache-read\n' +
      'rate. If EFFECTIVE rate ≈ full rate, your context is NOT being cached (you pay full price to\n' +
      're-send it every turn) — that is the big, invisible, recoverable waste. If EFFECTIVE ≈ cached\n' +
      'rate, caching is already working and there is little to reclaim here. Premium-request\n' +
      'multipliers can inflate the effective rate, so read the RELATIVE per-turn spread, not just\n' +
      'the absolute.\n',
  );
}
