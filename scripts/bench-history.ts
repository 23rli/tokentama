/**
 * Real-history token-savings benchmark. Reads your ACTUAL Copilot chat sessions
 * from disk, runs the offline rewrite over the real prompts, and measures real
 * numbers: metered tokens per session, prompt-text compression, and the cost of
 * real retry/re-ask loops that a clearer first prompt would avoid.
 *
 * Everything stays local. Picks the 5 longest conversations (~20 turns each).
 * Run: `npm run bench:history`  (or: node scripts/run-bench.mjs bench-history.ts)
 */
import { readFileSync } from 'node:fs';
import { listCopilotSessions } from '../src/capture/copilotPaths';
import {
  parseTranscript,
  parseChatSession,
  parseChatSessionTokens,
  type TurnTokens,
} from '@tokentama/ingestion';
import { leanRewrite } from '@tokentama/llm-adapters';
import { estimateTokens, resolvePricing } from '@tokentama/scoring-engine';
import { isReask } from '../src/analysis/retryDetect';
import { classifyDifficulty } from '../src/analysis/taskDifficulty';

const N_SESSIONS = 5;
const MIN_TURNS = 8; // a "conversation" worth measuring

// Opportunity-stack assumptions (deliberately conservative, labelled as estimates).
const RIGHTSIZE_FRAC = 0.35; // a lighter model / lower effort saves ~35% of a turn end-to-end
const COMPACT_THRESHOLD = 40000; // re-sent history (tokens) above which compaction pays off
const RECAP_TOKENS = 6000; // size of a lean recap that replaces the history
const TOOL_TRIM_FRAC = 0.3; // assume ~30% of tool definitions are unused / disable-able

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

interface SessionData {
  id: string;
  prompts: string[];
  responses: string[];
  real: (TurnTokens | undefined)[]; // aligned to user-turn order
  hasReal: boolean;
  model?: ReturnType<typeof parseChatSession>['model'];
}

function loadSession(s: ReturnType<typeof listCopilotSessions>[number]): SessionData | undefined {
  const parsed = parseTranscript(readText(s.transcriptPath));
  const turns = parsed.turns.filter((t) => (t.promptText ?? '').trim().length > 0);
  if (turns.length < MIN_TURNS) return undefined;

  let realArr: (TurnTokens | undefined)[] = [];
  let model: SessionData['model'];
  if (s.chatSessionPath) {
    const content = readText(s.chatSessionPath);
    if (content) {
      const map = parseChatSessionTokens(content);
      realArr = [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
      model = parseChatSession(content).model;
    }
  }

  return {
    id: s.sessionId.slice(0, 8),
    prompts: turns.map((t) => (t.promptText ?? '').trim()),
    responses: turns.map((t) => t.responseText ?? ''),
    real: turns.map((_, i) => realArr[i]),
    hasReal: realArr.length > 0,
    model,
  };
}

function pct(before: number, after: number): number {
  return before <= 0 ? 0 : Math.round((1 - after / before) * 100);
}

console.log('\n=== Tokentama — real Copilot history benchmark ===\n');

const all = listCopilotSessions();
const loaded = all
  .map(loadSession)
  .filter((x): x is SessionData => x != null)
  .sort((a, b) => b.prompts.length - a.prompts.length)
  .slice(0, N_SESSIONS);

if (loaded.length === 0) {
  console.log('No Copilot chat sessions with enough turns were found on this machine.');
  console.log('(Looked under %APPDATA%/Code/User/workspaceStorage/**/GitHub.copilot-chat/.)\n');
} else {
  let gTotal = 0;
  let gAfter = 0;
  let gRealCredits = 0;
  let gRealCreditsAfter = 0;
  let gRealCreditTurns = 0;
  // Opportunity stack (billed AIC), aggregated across sessions.
  let gRetryAic = 0;
  let gRightSizeAic = 0;
  let gCompactionAic = 0;
  let gToolAic = 0;

  for (const s of loaded) {
    let processed = 0; // sum of per-turn full model input+output (re-sent context included)
    let compressionSaved = 0; // measured prompt-text tokens removed
    let retryTokens = 0; // whole-turn tokens spent on real re-asks
    let retries = 0;
    let realCredits = 0;
    let realCreditsAfter = 0;
    let realCreditTurns = 0;
    // Opportunity stack for this session, in real billed AIC.
    let retryAic = 0;
    let rightSizeAic = 0;
    let compactionAic = 0;
    let toolAic = 0;
    const family = s.model?.family;
    const outRate = s.model?.outputPer1M ?? resolvePricing(family).outputUsdPerMillion * 1000;

    for (let i = 0; i < s.prompts.length; i++) {
      const p = s.prompts[i];
      const real = s.real[i];
      const promptTok = estimateTokens(p);
      const rw = leanRewrite(p).trim();
      const after = rw !== p && rw.length < p.length ? estimateTokens(rw) : promptTok;
      compressionSaved += promptTok - after;

      // Whole-turn cost: prefer real counts, else estimate from text.
      const inTok = real?.promptTokens ?? promptTok;
      const outTok = real?.completionTokens ?? estimateTokens(s.responses[i]);
      const turnTotal = inTok + outTok;
      processed += turnTotal;

      const realCredit = real?.copilotCredits ?? 0;
      if (realCredit > 0) realCreditTurns += 1;
      realCredits += realCredit;

      const retry = isReask(p, s.prompts[i - 1]);
      if (retry) {
        retries += 1;
        retryTokens += turnTotal;
      } else {
        realCreditsAfter += realCredit;
      }

      // --- Opportunity stack, grounded in this turn's REAL billed credits ---
      // Split billed credit into output (not cached, ~5x input rate) vs input
      // (mostly a cached prefix). Levers that cut OUTPUT (retry, right-size) save
      // real money; levers that cut cached INPUT (compaction, tools) save less.
      if (realCredit > 0) {
        const estOut = Math.min(realCredit, (outTok * outRate) / 1_000_000);
        const estIn = Math.max(0, realCredit - estOut);
        if (retry) retryAic += realCredit; // avoiding the re-ask saves the whole turn
        if (classifyDifficulty(p).level !== 'complex') rightSizeAic += realCredit * RIGHTSIZE_FRAC;
        const history = Math.max(0, inTok - promptTok); // prior context re-sent this turn
        if (history > COMPACT_THRESHOLD && inTok > 0) {
          compactionAic += estIn * (Math.max(0, history - RECAP_TOKENS) / inTok);
        }
        const details = real?.promptTokenDetails;
        if (details && inTok > 0) {
          const toolTok = details
            .filter((d) => /tool/i.test(d.label) || /tool/i.test(d.category))
            .reduce((sum, d) => sum + (inTok * d.percentageOfPrompt) / 100, 0);
          toolAic += estIn * (toolTok / inTok) * TOOL_TRIM_FRAC;
        }
      }
    }

    // Treatment = clearer prompts avoid the real re-asks + prompts are compressed.
    const afterTotal = processed - retryTokens - compressionSaved;
    const avgCtx = Math.round(processed / s.prompts.length);
    gTotal += processed;
    gAfter += afterTotal;
    gRealCredits += realCredits;
    gRealCreditsAfter += realCreditsAfter;
    gRealCreditTurns += realCreditTurns;
    gRetryAic += retryAic;
    gRightSizeAic += rightSizeAic;
    gCompactionAic += compactionAic;
    gToolAic += toolAic;

    console.log(`• session ${s.id}…  (${s.prompts.length} turns, tokens ${s.hasReal ? 'REAL' : 'estimated'})`);
    console.log(`  input+output processed across turns: ${processed.toLocaleString()} (~${avgCtx.toLocaleString()}/turn — context is re-sent each turn)`);
    console.log(`  real re-asks detected: ${retries}  ->  ${retryTokens.toLocaleString()} tokens re-sending whole turns`);
    console.log(`  prompt-text compression: ${compressionSaved} tokens`);
    console.log(
      `  savings if re-asks avoided + prompts compressed: ${(processed - afterTotal).toLocaleString()} tokens ` +
        `(${pct(processed, afterTotal)}%)`,
    );
    if (realCredits > 0) {
      console.log(`  real billed credits: ${realCredits.toFixed(2)} -> ${realCreditsAfter.toFixed(2)} AIC`);
      const sp = (a: number): number => Math.round((a / realCredits) * 100);
      console.log(
        `  opportunity stack (share of ${realCredits.toFixed(0)} billed AIC; NOT additive): ` +
          `retry ${retryAic.toFixed(0)} (${sp(retryAic)}%) · right-size ${rightSizeAic.toFixed(0)} (${sp(rightSizeAic)}%) · ` +
          `compaction ${compactionAic.toFixed(0)} (${sp(compactionAic)}%) · tool-trim ${toolAic.toFixed(0)} (${sp(toolAic)}%)`,
      );
    }
    console.log('');
  }

  console.log('--- Across the 5 longest real conversations ---');
  console.log(
    `processed tokens: ${gTotal.toLocaleString()} -> ${gAfter.toLocaleString()}   ` +
      `saved ${(gTotal - gAfter).toLocaleString()} (${pct(gTotal, gAfter)}%)`,
  );
  if (gRealCreditTurns > 0) {
    console.log(
      `real billed credits (${gRealCreditTurns} metered turns): ${gRealCredits.toFixed(2)} -> ` +
        `${gRealCreditsAfter.toFixed(2)} AIC   saved ${(gRealCredits - gRealCreditsAfter).toFixed(2)} AIC`,
    );
    const sp = (a: number): number => (gRealCredits > 0 ? Math.round((a / gRealCredits) * 100) : 0);
    console.log('\n--- Opportunity stack across all sessions (share of billed AIC; NOT additive) ---');
    console.log(`  retry-avoidance:  ${gRetryAic.toFixed(0)} AIC (${sp(gRetryAic)}%)   [cuts whole re-ask turns incl. output]`);
    console.log(`  right-sizing:     ${gRightSizeAic.toFixed(0)} AIC (${sp(gRightSizeAic)}%)   [down-route trivial/moderate turns]`);
    console.log(`  compaction:       ${gCompactionAic.toFixed(0)} AIC (${sp(gCompactionAic)}%)   [re-sent history is cached → small billed win]`);
    console.log(`  tool-trim:        ${gToolAic.toFixed(0)} AIC (${sp(gToolAic)}%)   [disable unused tool defs]`);
  } else {
    console.log('real billed credits: not metered in these agent sessions (rely on the % above).');
  }
  console.log(
    '\nHow to read this: the opportunity stack is in REAL billed AIC. The big levers are the\n' +
      'ones that cut OUTPUT tokens (retry-avoidance, right-sizing) — output is billed ~5x input\n' +
      'and is NOT cached. Compaction and tool-trim cut re-sent INPUT, which is mostly a cache\n' +
      'hit (~10% rate), so their billed win is smaller than the raw token counts suggest — they\n' +
      'matter most on cold caches or context that overflows the cache window. Levers are not\n' +
      'additive (a re-ask is also right-sizable). Compression stays a rounding error.\n',
  );
}
