# EcoPrompt Guardians — Recontextualized Master Design & Engineering Spec

> **Status:** Draft v2.0 (recontextualized for the shipping codebase)
> **Audience:** The next engineer / GitHub Copilot chat picking up this repo to build the
> **Token Economics** feature layer.
> **What changed from v1.0:** v1.0 described an *aspirational* greenfield build (Electron +
> React + PixiJS + Azure Functions + Foundry, a monorepo). This v2.0 describes the app **as it
> actually exists today** — a single **VS Code extension** that already captures **real Copilot
> token + credit data** — and specifies the new metrics to build **on top of it**. The vision,
> the scoring philosophy, the emotional pet mechanic, and the Microsoft-alignment narrative are
> unchanged; only the architecture and roadmap are corrected to match reality.

---

## 0. How to read this document

This is both a **strategy doc** (why this matters) and an **engineering spec** (what to build
and exactly where it plugs in). If you only have time for the build, read:

- **§5 — What's already built** (so you don't rebuild it)
- **§6 — Real architecture** (the actual data flow)
- **§7 — Real domain contracts** (the types you'll extend)
- **§11 — Token Economics layer** (the new features — the meat)
- **§16 — Implementation backlog + Copilot prompts** (copy-paste starting points)
- **§17 — Verification** (how to know it works)

Everything is grounded in real files. Every path and type named below **exists in the repo today**
unless explicitly marked `NEW`.

---

## 1. Executive Summary

EcoPrompt Guardians (codename **tokentama**) is a sustainability-focused AI-efficiency companion
that lives **inside VS Code**. It makes the invisible cost of inefficient GitHub Copilot usage —
wasted tokens, redundant context, retry loops, tool over-use — **visible, coachable, and
emotionally engaging**.

The core idea is unchanged from v1.0:

- Many users unintentionally waste AI resources through verbose prompts, repeated retries,
  unnecessary context stuffing, and poor prompt structure.
- At small scale those inefficiencies feel trivial; **at Microsoft scale they become material
  cost, latency, infrastructure, and sustainability concerns**.
- EcoPrompt Guardians turns that invisible inefficiency into something visible and actionable.

What is **different and better than v1.0**: we are no longer guessing at token cost. The extension
**reads the real, metered token counts and Copilot credits** that VS Code writes to disk per
request, and prices them with the **real per-model rates** Copilot ships in `models.json`. That
turns the product from a "cute estimate" into a **credible, data-backed efficiency dashboard**.

The product experience is a small **sidebar webview** with a Clippy-inspired tamagotchi mechanic:

- When you prompt efficiently, the ecosystem thrives.
- When you waste tokens and tools, the world deteriorates.
- A coach offers concise improvement tips and rewritten prompt suggestions.

**This v2.0 adds the "Token Economics" layer:** per-prompt *cost of waste* ("you could have saved
~N tokens / X credits / $Y / Zg CO₂e"), cumulative session savings, per-category attribution,
token-usage trends, per-model cost comparison, and an at-scale projection.

---

## 2. Why This Matters Now (unchanged narrative)

- Microsoft's FY26 Q3 earnings call explicitly tied gross-margin pressure to continued AI
  infrastructure investment and growing AI usage, alongside ongoing work to reduce cost of goods
  sold (COGS), improve **tokens-per-dollar**, and improve throughput. AI usage growth and AI
  efficiency are real, top-level infrastructure and operating concerns.
- Microsoft sustainability materials state that optimizing AI applications is critical because
  generative LLMs are power-intensive and raise both cost and environmental concerns.
- Internal guidance repeats the themes: **"Optimize before you scale," "Reduce tokens per task,"
  "Treat tokens as a scarce resource,"** and connect token consumption to delivery outcomes.
- Strategy discussions emphasize **reusable skills, agents, and guardrails** rather than every team
  rebuilding independently.

**Framing:** EcoPrompt Guardians is not a hackathon novelty. It is aligned with real enterprise
concerns around AI cost discipline, sustainable compute usage, and prompt-quality maturity — and it
now has the **real telemetry** to prove the point.

---

## 3. Business Problem (unchanged)

Most AI users are not bad actors — they are simply inefficient. Common patterns:

- Overly long prompts with irrelevant context; re-pasting prior context instead of referencing it.
- Repeating the same request with tiny differences (retry loops).
- Vague asks that force clarifying loops.
- Expensive reasoning paths for simple tasks; too many tool calls for a small outcome.
- Requesting exhaustive verbosity where a bounded output would do.

These create **monetary, infrastructure, time, UX, and sustainability** waste. Current AI products
optimize for *successful* answer generation, not *efficient* answer generation — token usage is
mostly invisible, prompt quality is rarely coached in a lightweight way, and cost/sustainability are
rarely surfaced in an emotionally compelling experience. That gap is what this product fills.

---

## 4. Product Vision & Thesis (unchanged)

> **EcoPrompt Guardians helps users build efficient AI habits by making prompt quality, token
> waste, and sustainability visible, coachable, and emotionally engaging.**

If users can see AI inefficiency in real time, paired with a visible consequence, a playful
emotional loop, a clear improvement recommendation, and a sense of measurable impact, they will
meaningfully improve their prompting behavior.

**Winning narrative:** most AI projects help users do *more* with AI; EcoPrompt Guardians helps
users do **better** with AI.

---

## 5. What's Already Built (read this before building anything)

The repository root **is** the extension. This is not a monorepo anymore (old `packages/` and
`apps/` folders are inert and `.vscodeignore`d; `token-lens/` and `vscode-pets/` are untracked
*reference* clones). The shipping pieces:

| Capability | Where | Status |
| --- | --- | --- |
| Extension host (activation, commands, capture orchestration, chat participant) | [`src/extension.ts`](../src/extension.ts) | ✅ done |
| Passive capture of live Copilot chats from disk | [`src/capture/`](../src/capture/) | ✅ done |
| **Real** token + credit extraction (metered, per request) | [`src/capture/parsers/chatSessionTokens.ts`](../src/capture/parsers/chatSessionTokens.ts) | ✅ done |
| Real per-model pricing/capabilities from `models.json` | [`src/capture/parsers/modelCatalog.ts`](../src/capture/parsers/modelCatalog.ts) | ✅ done |
| Deterministic waste/efficiency scoring (6 detectors) | [`src/scoring/`](../src/scoring/) | ✅ done |
| Coaching (heuristic always; optional LLM) + prompt rewrites | [`src/coaching/`](../src/coaching/) | ✅ done |
| State store + persistence + 6 headline metrics | [`src/state/guardianStore.ts`](../src/state/guardianStore.ts), [`src/metrics/metrics.ts`](../src/metrics/metrics.ts) | ✅ done |
| Tamagotchi pet sidebar (Preact webview) | [`webview-ui/`](../webview-ui/), [`src/webview/`](../src/webview/) | ✅ done |
| Status bar indicator | [`src/status/statusBar.ts`](../src/status/statusBar.ts) | ✅ done |

**Crucial implication for the new work:** the app already has tokens, credits, USD cost, model
pricing, CO₂e, scores, waste breakdown, and coaching. **The one thing missing is the link between
them** — today the *waste score* (a 0–100 behavioral number) and the *token quantities* are
computed in independent flows. **Connecting waste to real tokens/credits/dollars is the entire
Token Economics feature.** You are not building a new app; you are wiring two existing flows
together and surfacing the result.

---

## 6. Real Architecture (replaces v1.0 §14–18)

### 6.1 The two runtimes

```
┌────────────────────────────────────────────────────────────────────┐
│ Extension Host (Node)  —  src/  →  esbuild  →  dist/extension.js     │
│   • activate(), commands, chat participant   (src/extension.ts)      │
│   • Capture pipeline                          (src/capture/*)        │
│   • Deterministic scoring engine              (src/scoring/*)        │
│   • Coaching (heuristic + optional LLM)        (src/coaching/*)      │
│   • GuardianStore (state + persistence)        (src/state/*)         │
│   • Metrics                                    (src/metrics/*)       │
│   • DashboardViewProvider (host↔webview bridge)(src/webview/*)       │
└───────────────▲──────────────────────────────────┬──────────────────┘
                │ HostMessage { type:'state', state }│ WebviewMessage
                │ (pushed on every store change)     ▼ (ready/score/reset/applyTip…)
┌───────────────┴──────────────────────────────────────────────────────┐
│ Webview (Preact)  —  webview-ui/  →  esbuild  →  dist/webview.{js,css} │
│   PetStage · ScoreHeader · ModelCard · CoachingPanel ·                 │
│   MetricsGrid · WasteBreakdown                                         │
└───────────────────────────────────────────────────────────────────────┘
```

There is **no Electron, no Azure Functions, no PixiJS, no HTTP API**. Scoring/coaching run
**in-process** in the extension host. The webview is a plain Preact app talking to the host over
the standard VS Code webview message channel.

### 6.2 The capture pipeline (where real data comes from)

VS Code stores Copilot chat data on disk under the workspace-hash storage folder:

```
%APPDATA%\Code\User\workspaceStorage\<workspaceHash>\GitHub.copilot-chat\
├── transcripts\<sessionId>.jsonl        → prompt text, assistant text, tool calls (append-only)
├── chatSessions\<sessionId>.jsonl       → per-request promptTokens / completionTokens /
│                                           copilotCredits / promptTokenDetails (patch log)
└── debug-logs\<sessionId>\models.json   → full model picker catalog incl. real pricing
```

Flow ([`src/capture/copilotReader.ts`](../src/capture/copilotReader.ts) `readSessionEvents()`):

1. `parseTranscript()` → turns with `promptText`, `responseText`, `toolCalls`.
2. `parseChatSessionTokens()` → `Map<turnIndex, { promptTokens, completionTokens, copilotCredits }>`
   (last-write-wins over `["requests", N, field]` patches). **These are the real metered counts.**
3. `parseModelCatalog()` + `parseChatSession()` → the session's selected `ModelInfo` with pricing.
4. `buildPromptEvent({ …, inputTokensOverride, outputTokensOverride, copilotCredits })`
   ([`src/capture/parsers/promptEventFactory.ts`](../src/capture/parsers/promptEventFactory.ts))
   merges real counts over the `estimateTokens()` fallback and sets `tokens.estimated = false`
   when real counts were present.

The watcher ([`src/capture/CopilotWatcher.ts`](../src/capture/CopilotWatcher.ts)) is scoped to **this
window's workspace hash** and uses an mtime-guarded poll fallback (watching files outside the
workspace is unreliable). It **waits for real tokens** before scoring an ambient capture.

> **Capture truth (do not regress):** user prompts are reliably found in `transcripts/`, *not* by
> reconstructing `chatSessions/` (that path loses per-turn message text). Token numbers come from
> `chatSessions/`. Keep these two responsibilities separate.

### 6.3 Score → coach → store → webview

```
PromptEvent
  │  SessionTracker.toScoreRequest()      (rolling 8-prompt window for retry/redundancy)
  ▼
ScorePromptRequest
  │  scorePrompt(req, { previousScore })   (src/scoring/scorePrompt.ts)
  ▼
ScorePromptResponse { overallScore, wasteScore, subscores, wasteBreakdown, petState, delta, tokens }
  │  maybeCoach() → TipView                 (src/core/scoreService.ts → src/coaching/coach.ts)
  ▼
GuardianStore.recordScore()               (src/state/guardianStore.ts)
  │  → ScoredRecord[], history[], counters, lastEvent
  ▼
computeMetrics() → SuccessMetrics          (src/metrics/metrics.ts)
  ▼
GuardianState  ── HostMessage 'state' ──▶  Preact webview
```

### 6.4 Build, aliases, and dev-host gotchas (must know)

- **Build:** `npm run build` (`node esbuild.mjs`) → `dist/extension.js` + `dist/webview.{js,css}`.
- **Typecheck:** `npm run typecheck` (`tsc --noEmit`, covers `src` + `webview-ui/src`).
- **Test:** `npm test` (`vitest run`) — pure-logic unit tests under `src/**/__tests__`.
- **`@ecoprompt/*` import aliases live in THREE places that must stay in sync:**
  `tsconfig.json` `paths`, `esbuild.mjs` `alias`, and `vitest.config.ts` `resolve.alias`. If you add
  or move an aliased import, update all three or the build/test/editor will disagree.
- **Dev host runs the bundled `dist/`.** After changing capture or any host code, you must
  **Rebuild + Restart** the Extension Development Host (a reload is not enough for contribution
  changes). `node scripts/diag.mjs` is a hermetic capture-health check; `node scripts/smoke.mjs`
  runs the pipeline with `vscode` mocked.
- **Environment:** Node may not be on PATH (installed at `C:\Program Files\nodejs`); PowerShell
  execution policy can block `npm.ps1` (`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
  -Force`).

---

## 7. Real Domain Contracts (replaces v1.0 §19)

These are the **actual** types in the repo today. The `NEW` fields are what the Token Economics
layer adds — they are all **optional** so nothing breaks while you build incrementally.

### 7.1 `PromptEvent` / `TokenEstimate` / `ModelInfo` — [`src/types/PromptEvent.ts`](../src/types/PromptEvent.ts)

```ts
export interface TokenEstimate {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  estimatedCostUsd: number;       // priced with REAL per-model rates
  copilotCredits?: number;        // REAL metered credits, when on disk
  estimated: boolean;             // false when counts are real
}

export interface ModelInfo {
  id: string; family: string; vendor?: string; name?: string;
  inputPer1M?: number;            // credits per 1M input tokens (models.json)
  outputPer1M?: number;
  cacheReadPer1M?: number;
  cacheWritePer1M?: number;
  contextMaxTokens?: number;
  category?: string;              // e.g. 'powerful'
  priceCategory?: string;         // e.g. 'high'
  // …limits + reasoning fields
}
```

### 7.2 `WasteComponent` / `ScorePromptResponse` — [`src/types/Score.ts`](../src/types/Score.ts)

```ts
export type WasteCategory =
  | 'redundantContext' | 'vagueness' | 'retryLoop'
  | 'toolOveruse' | 'verbosityMismatch' | 'ignoredCoaching';

export interface WasteComponent {
  category: WasteCategory;
  severity: number;          // 0..1 before weighting
  weightedPoints: number;    // contribution to the 0..100 Waste Score
  reason: string;
  // ── NEW (Token Economics) ──────────────────────────────
  estimatedTokensSaved?: number;     // tokens attributable to this waste, if fixed
  estimatedCreditsSaved?: number;    // priced via model.inputPer1M / outputPer1M
  estimatedCostSavedUsd?: number;    // priced via pricing.ts
}

export interface ScorePromptResponse {
  overallScore: number; wasteScore: number;
  subscores: Subscores; reasons: string[]; improvements: string[];
  petState: PetWorldState; delta: number;
  wasteBreakdown: WasteComponent[];
  tokens?: TokenEstimate;
  // ── NEW: per-prompt rollups (sum of component savings, capped) ──
  estimatedTokensSaved?: number;
  estimatedCreditsSaved?: number;
  estimatedCostSavedUsd?: number;
  estimatedCo2eSavedGrams?: number;
}
```

### 7.3 `TipResponse` — [`src/types/Tip.ts`](../src/types/Tip.ts) (already has savings; we *use* it)

```ts
export interface EstimatedSavings {
  estimatedTokenReductionPct?: number;
  estimatedLatencyReductionPct?: number;
}
export interface TipResponse {
  shortTip: string; detailedTip: string;
  rewrittenPrompt?: string;
  estimatedSavings?: EstimatedSavings;   // ← rewrite-based signal we feed into §11.1
  source: string;
}
```

### 7.4 Webview contract — [`src/webview/contract.ts`](../src/webview/contract.ts)

```ts
export interface ScoredEventView {
  promptPreview: string; overallScore: number; wasteScore: number; delta: number;
  inputTokens: number; outputTokens: number; estimatedCostUsd: number;
  copilotCredits?: number; tokensReal?: boolean;
  wasteBreakdown: WasteComponent[];      // ← now carries per-category savings
  reasons: string[]; improvements: string[]; timestamp: string;
  source: 'manual' | 'copilot';
  // ── NEW: per-prompt savings rollup for the UI ──
  estimatedTokensSaved?: number;
  estimatedCreditsSaved?: number;
  estimatedCostSavedUsd?: number;
  estimatedCo2eSavedGrams?: number;
}

export interface SuccessMetrics {
  // existing
  tokenReductionPct: number; wasteReductionPct: number;
  promptQualityImprovementPct: number; averageScoreIncrease: number;
  coachingEngagement: number;
  sustainabilityWhSaved: number; sustainabilityCo2eGrams: number;
  promptsScored: number; tipsShown: number; tipsApplied: number;
  totalTokens: number; totalCostUsd: number; totalCredits: number;
  // ── NEW: Token Economics ──────────────────────────────
  cumulativeTokensSaved: number;
  cumulativeCreditsSaved: number;
  cumulativeCostSavedUsd: number;
  savingsByCategory: Array<{
    category: WasteCategory;
    tokens: number; credits: number; costUsd: number; sharePct: number;
  }>;
  tokenTrend: Array<{ t: number; inputTokens: number; outputTokens: number; cachedTokens?: number }>;
  modelComparison?: Array<{ modelId: string; family: string; costUsd: number; credits: number; deltaPct: number }>;
  scaleProjection?: ScaleProjection;   // see §11.6
}
```

---

## 8. Scoring Philosophy (unchanged — do NOT "fix" it)

- **Long ≠ bad.** A long prompt can be highly efficient if it prevents retries, ambiguity, and
  clarification loops. We score **waste**, not length.
- **Overall Score = 100 − Waste Score.** The Waste Score is a weighted sum of six avoidable-waste
  categories (weights from [`src/scoring/calculators/wasteScore.ts`](../src/scoring/calculators/wasteScore.ts)):

  | Category | Weight | Detector flags |
  | --- | --- | --- |
  | `redundantContext` | 0.30 | internal duplication, re-pasted/bulk context |
  | `vagueness` | 0.20 | underspecified asks, no deliverable, high pronoun ratio |
  | `retryLoop` | 0.20 | near-duplicate prompts, retry cues, retry count |
  | `toolOveruse` | 0.15 | tool count over budget, failures, repetition |
  | `verbosityMismatch` | 0.10 | verbose cues, output ≫ task size |
  | `ignoredCoaching` | 0.05 | previous tip not adopted |

  `structuredPrompt` is a **positive** signal that reduces effective vagueness.
- **Five subscores** (each 0–100): promptQuality, contextEfficiency, toolEfficiency,
  outputEfficiency, learningAdoption.

The Token Economics layer **consumes these severities**; it does not change the weights or the
detectors.

---

## 9. The Pet / World Mechanic (unchanged)

States ([`src/types/PetWorldState.ts`](../src/types/PetWorldState.ts)):
`thriving → healthy → concerned → critical → collapse → dead`, driven by a smoothed health EMA
(`health = health*0.6 + score*0.4`) mapped through `scoreToState()`. Each state changes background,
plants, the guardian's pose/expression, and the coaching tone. The state machine keeps engineering
(score→state) and design (sprites per state) decoupled. Rendered by
[`webview-ui/src/components/PetStage.tsx`](../webview-ui/src/components/PetStage.tsx).

The new savings numbers should **reinforce** this loop ("you just saved ~4 credits — the tree
perks up"), never replace it.

---

## 10. AI Coach Design (unchanged interaction model)

`generateTip()` ([`src/coaching/coach.ts`](../src/coaching/coach.ts)) tries the LLM coach when
configured (`ECO_LLM_PROVIDER` = `azure-openai` | `foundry` | `openai`) and always falls back to the
deterministic heuristic coach ([`src/coaching/heuristicCoach.ts`](../src/coaching/heuristicCoach.ts)).
It returns a short tip, an optional **rewritten prompt**, and `estimatedSavings`
(`estimatedTokenReductionPct`, `estimatedLatencyReductionPct`). Tone: playful, concise,
constructive — never scolding.

**The rewritten prompt is the second input to our savings estimate** (see §11.1).

---

## 11. NEW: Token Economics Layer (the feature work)

Goal: translate the existing **waste score + real tokens/credits/pricing** into concrete,
clearly-labeled answers to *"what did this cost, and what could I have saved?"*

Six features, tiered. Features 1–3 share one core engine and are the MVP.

### 11.1 Core engine + F1 — Cost of waste per prompt  ·  *(MVP / must)*

**Outcome:** every scored prompt shows *"≈ N tokens (≈ X credits · ≈ $Y · ≈ Zg CO₂e) of this turn
was avoidable,"* broken down by waste category.

**Methodology — heuristic baseline, refined by the rewrite (the decided approach):**

1. **Heuristic attribution.** A new module
   `NEW` [`src/scoring/models/wasteCostModel.ts`](../src/scoring/models/wasteCostModel.ts) holds a
   tunable coefficient table mapping each `WasteCategory` to a fraction of a token base:

   | Category | Coefficient × base | Rationale |
   | --- | --- | --- |
   | `redundantContext` | `0.25 × inputTokens` | re-pasted/duplicate context bloats input |
   | `vagueness` | `0.30 × outputTokens` | vague asks trigger clarifying loops / larger output |
   | `retryLoop` | `0.40 × totalTokens` | a retry ≈ near-full re-spend |
   | `toolOveruse` | `~500 × excessToolCount` (cap `0.15 × totalTokens`) | each extra tool round-trip |
   | `verbosityMismatch` | `0.50 × outputTokens` | over-generation |
   | `ignoredCoaching` | `0.20 × totalTokens` | rework above an efficient baseline |

   Per component: `tokensWasted = severity × coeff × base`. **Use the real `TokenEstimate`
   counts when `tokens.estimated === false`**, else the estimate. **Cap the sum at ~70% of total
   tokens** so we never claim a turn was almost entirely waste.

2. **Rewrite refinement.** When the coach produced a `rewrittenPrompt`, compute
   `visibleDelta = estimateTokens(originalVisiblePrompt) − estimateTokens(rewrittenPrompt)`
   (using [`src/scoring/models/tokenizer.ts`](../src/scoring/models/tokenizer.ts)). Blend it into
   the **input-side** component (`max`/weighted-mean with the heuristic input attribution).
   **Document the caveat in the UI tooltip:** real `promptTokens` include hidden context (history,
   tool defs, attachments), so the rewrite delta is a **lower bound** on input savings.

3. **Pricing.** Convert tokens → credits with `model.inputPer1M` / `model.outputPer1M`
   (split input vs output attribution), and tokens → USD via
   [`src/scoring/models/pricing.ts`](../src/scoring/models/pricing.ts) (`estimateCostUsd`,
   `resolvePricing`). Convert tokens → CO₂e with the existing sustainability config
   (`whPerThousandTokens` default `0.4`, `gridGramsCo2PerKwh` default `400`).

**Where it plugs in:**
- Types: add the `NEW` fields in §7.2 to [`src/types/Score.ts`](../src/types/Score.ts).
- Compute: in [`src/scoring/scorePrompt.ts`](../src/scoring/scorePrompt.ts), after `wasteBreakdown`
  and `tokens` are known, call `computeWasteSavings(wasteBreakdown, tokens, model, rewrite?)` and
  attach per-component + rollup fields. (Keep `scorePrompt` pure — pass `rewrite` in, don't call the
  coach from inside scoring. If the rewrite isn't available at scoring time, refine in
  [`src/core/scoreService.ts`](../src/core/scoreService.ts) after `maybeCoach()`.)
- Surface: copy rollups onto `ScoredEventView` in
  [`src/state/guardianStore.ts`](../src/state/guardianStore.ts) `recordScore()`.
- UI: extend [`webview-ui/src/components/WasteBreakdown.tsx`](../webview-ui/src/components/WasteBreakdown.tsx)
  to show a "≈ X credits avoidable" figure per row + a per-prompt headline. Add a
  `NEW` `SavingsCard.tsx` for the headline if WasteBreakdown gets crowded.

**Unit test (`NEW`):** `src/scoring/__tests__/wasteCostModel.test.ts` — deterministic inputs →
expected token/credit/USD savings; verify the 70% cap and the estimated-vs-real branch.

### 11.2 F2 — Cumulative session savings counter  ·  *(MVP / must)*

**Outcome:** a running *"this session you've avoided ≈ 1.4k tokens · ≈ 9 credits · ≈ $0.06."*

- Extend `SuccessMetrics` with `cumulativeTokensSaved` / `cumulativeCreditsSaved` /
  `cumulativeCostSavedUsd` (§7.4).
- Extend `ScoredRecord` ([`src/metrics/metrics.ts`](../src/metrics/metrics.ts)) with the per-prompt
  savings, populated in `recordScore()`.
- Sum them in `computeMetrics()`.
- UI: add a savings tile to
  [`webview-ui/src/components/MetricsGrid.tsx`](../webview-ui/src/components/MetricsGrid.tsx) (or the
  new `SavingsCard`).

### 11.3 F3 — Per-waste-category attribution  ·  *(MVP / must)*

**Outcome:** *"Most of your waste this session came from Retry Loop (47%) and Redundant Context
(31%)."*

- Add `savingsByCategory` to `SuccessMetrics` (§7.4).
- Extend `ScoredRecord` with a compact `Record<WasteCategory, number>` (tokens) so
  `computeMetrics()` can aggregate and compute `sharePct`.
- UI: `NEW` `CategoryAttribution.tsx` — a ranked horizontal bar list reusing the orange waste color
  already in the styles.

### 11.4 F4 — Tokens-used breakdown & trend  ·  *(nice-to-have)*

**Outcome:** a small stacked chart of input/output(/cache) tokens across the session's turns.

- Add `tokenTrend` to `SuccessMetrics` (already on each `ScoredRecord` via input/output tokens; add
  `cachedTokens` if you wire §11.7).
- UI: `NEW` `TokenTrendChart.tsx`. Reuse the lightweight inline-SVG sparkline approach already in
  [`webview-ui/src/components/ScoreHeader.tsx`](../webview-ui/src/components/ScoreHeader.tsx), or
  borrow the chart/coloring pattern from the reference clone
  [`token-lens/src/bars.ts`](../token-lens/src/bars.ts) and `token-lens/webview-ui` `Chart.tsx`.

### 11.5 F5 — Per-model cost comparison  ·  *(nice-to-have)*

**Outcome:** *"This turn cost ≈ 23 credits on Claude Opus 4.8; on Sonnet it'd be ≈ 14; on a
mini model ≈ 4."*

- We already parse the **full** picker catalog with real pricing
  ([`src/capture/parsers/modelCatalog.ts`](../src/capture/parsers/modelCatalog.ts) →
  `parseModelCatalog`, `resolveModel`). No OpenRouter needed.
- `NEW` helper `computeModelComparison(tokens, catalog, currentFamily)` → cost/credits per candidate
  model + `deltaPct` vs current. (The reference clone
  [`token-lens/src/webview-model-cost.ts`](../token-lens/src/webview-model-cost.ts)
  `computeModelCostEstimates()` is a good shape to mirror.)
- Populate `SuccessMetrics.modelComparison`; UI: `NEW` `ModelComparison.tsx` table near `ModelCard`.

### 11.6 F6 — Scale projection / financial model  ·  *(stretch)*

**Outcome:** a scenario table extrapolating per-prompt savings to a team/org, with 10% / 20% / 35%
improvement bands — directional, never overclaimed.

```ts
// NEW src/metrics/scaleProjection.ts
export interface ScaleProjection {
  assumptions: { employees: number; promptsPerDay: number; workdaysPerYear: number };
  scenarios: Array<{ improvementPct: number; annualTokensSaved: number;
                     annualCreditsSaved: number; annualCostSavedUsd: number;
                     annualCo2eSavedKg: number }>;
}
export function projectAnnualSavings(perPrompt: { tokensSaved: number; creditsSaved: number;
  costSavedUsd: number; co2eGrams: number }, assumptions): ScaleProjection;
```

- Assumptions come from new settings under `ecoprompt.scale.*` (employees, promptsPerDay,
  workdaysPerYear) with sane defaults.
- UI: `NEW` `ScaleProjectionPanel.tsx`. **Label every figure "estimated"; use "~"; show the
  assumptions inline** so a reviewer can challenge them transparently.

### 11.7 (stretch) Cache-token accuracy

`chatSessions/` records `promptTokenDetails` (a category breakdown incl. cache). Parsing cache
read/write into `TokenEstimate.cachedTokens` sharpens F4 and pricing (cache is far cheaper). Treat
as a follow-up — it's extra parsing in
[`src/capture/parsers/chatSessionTokens.ts`](../src/capture/parsers/chatSessionTokens.ts) and not
required for the MVP.

### 11.8 Worked example (illustrative, from real on-disk data)

A real captured turn (Claude Opus 4.8): **input ≈ 27,539 tokens, output ≈ 2,029 tokens, 23.1 real
credits**, USD ≈ `(27539×0.5 + 2029×2.5)/1e6 ≈ $0.0188`. Suppose `wasteScore = 45`, dominated by
`redundantContext` (severity 0.6) and `retryLoop` (severity 0.4):

- redundantContext → `0.6 × 0.25 × 27,539 ≈ 4,130` input tokens ≈ `4130 × 500/1e6 ≈ 2.1` credits.
- retryLoop → `0.4 × 0.40 × 29,568 ≈ 4,731` total tokens ≈ `~3.0` credits.
- **Headline: "≈ 8.9k tokens · ≈ 5 credits (~22% of this turn) was avoidable (~$0.004)."**

Numbers are estimates from the coefficient model — present them with "~" and a methodology tooltip.

---

## 12. Telemetry / Events (recontextualized)

No Application Insights in the extension. Use the existing **`EcoPrompt Guardians` output channel**
for human-readable event logs, and (optionally) `vscode.env.createTelemetryLogger` for opt-in
aggregate telemetry. Keep the v1.0 event names as the logical schema:
`prompt_scored`, `tip_generated`, `prompt_rewritten`, `pet_state_changed`, `tip_accepted`,
`tip_ignored`, `score_recovered`, plus **new** `waste_costed` (carry `estimatedTokensSaved`,
`estimatedCreditsSaved`, dominant category). Never log raw prompt text in telemetry.

---

## 13. Privacy & Responsible Design (unchanged, reinforced)

- **Local-first.** All capture reads happen on the user's machine; real token data never leaves
  disk. Persist **derived metrics**, not raw prompt text (the store keeps a 180-char preview only).
- **No shaming.** Phrase savings as opportunity: *"This prompt could likely be ~22% leaner,"* not
  *"you wasted 22%."*
- **Transparency.** Every savings figure is a labeled estimate with a visible methodology; the
  coefficient table is tunable via settings so the numbers are auditable.

---

## 14. Success Metrics (existing six + new savings metrics)

Existing headline metrics (kept): tokenReductionPct, wasteReductionPct, promptQualityImprovementPct,
averageScoreIncrease, coachingEngagement, sustainabilityCo2eGrams — plus the raw totals
(promptsScored, tips, totalTokens, totalCostUsd, totalCredits).

**Added by this work:** cumulativeTokensSaved, cumulativeCreditsSaved, cumulativeCostSavedUsd,
savingsByCategory, tokenTrend, modelComparison, scaleProjection.

---

## 15. MVP Scope for the New Work

- **Must (MVP):** F1 cost-of-waste per prompt · F2 cumulative savings counter · F3 per-category
  attribution. (One shared engine: `wasteCostModel.ts`.)
- **Nice:** F4 token trend chart · F5 per-model cost comparison.
- **Stretch:** F6 scale projection · §11.7 cache-token accuracy.

Ship F1–F3 first; they share the core and deliver the headline "what could I have saved" story.

---

## 16. Implementation Backlog + Copilot Prompts

Suggested order, each item is a self-contained PR. The bracketed text is a copy-paste prompt for the
implementing Copilot chat.

1. **Types** — extend `WasteComponent`, `ScorePromptResponse`, `ScoredEventView`, `SuccessMetrics`
   with the optional `NEW` savings fields in §7. *(no behavior change yet)*
   > *"Add the optional savings fields from §7.2 and §7.4 of
   > docs/EcoPrompt_Guardians_Recontextualized.md to src/types/Score.ts and
   > src/webview/contract.ts. Keep them all optional. Run npm run typecheck."*

2. **Core engine** — `NEW src/scoring/models/wasteCostModel.ts` with the §11.1 coefficient table and
   `computeWasteSavings(wasteBreakdown, tokens, model, rewrite?)`; unit-test it.
   > *"Implement wasteCostModel.ts per §11.1 (coefficients, 70% cap, real-vs-estimate branch,
   > credits via model.inputPer1M/outputPer1M, USD via pricing.ts, CO₂e via the 0.4 Wh /
   > 400 g·kWh⁻¹ config). Add src/scoring/__tests__/wasteCostModel.test.ts."*

3. **Wire F1** — call `computeWasteSavings` from `scorePrompt.ts` (heuristic) and refine with the
   rewrite in `scoreService.ts` after `maybeCoach()`; copy rollups onto `ScoredEventView` in
   `recordScore()`. Extend `WasteBreakdown.tsx` + add `SavingsCard.tsx`.

4. **Wire F2 + F3** — extend `ScoredRecord` (per-prompt savings + per-category map), aggregate in
   `computeMetrics()`, render in `MetricsGrid.tsx` + `CategoryAttribution.tsx`.

5. **F4** — `tokenTrend` in metrics + `TokenTrendChart.tsx` (reuse the ScoreHeader sparkline pattern).

6. **F5** — `computeModelComparison()` over `parseModelCatalog()` + `ModelComparison.tsx`.

7. **F6** — `NEW src/metrics/scaleProjection.ts` + settings `ecoprompt.scale.*` +
   `ScaleProjectionPanel.tsx`; unit-test `projectAnnualSavings`.

> **Reminder for every PR:** if you add a new `@ecoprompt/*` import, update the alias in all three
> of `tsconfig.json`, `esbuild.mjs`, and `vitest.config.ts`. After host changes, Rebuild + Restart
> the dev host.

---

## 17. Verification

- `npm run typecheck` — clean.
- `npm test` — existing suite green + new tests for `wasteCostModel` and `scaleProjection`.
- `npm run build` — emits `dist/extension.js` + `dist/webview.{js,css}`.
- `node scripts/smoke.mjs` — hermetic pipeline (vscode mocked).
- `node scripts/diag.mjs` — live capture health.
- **F5 dev host** (launch opens `sandbox/` so it gets its own workspace hash) → run
  **"EcoPrompt: Scan recent Copilot prompts"** (`ecoprompt.rescan`) → confirm the savings headline,
  per-category attribution, cumulative counter, and (if built) model comparison render against real
  captured turns.
- **Doc-grounding check:** every file path and type referenced here resolves in the repo (the `NEW`
  ones are the only intended additions).

---

## 18. Risks & Mitigations (recontextualized)

| Risk | Mitigation |
| --- | --- |
| Savings feel arbitrary / overclaimed | Conservative coefficients + 70% cap, "~ estimated" labels, visible methodology, tunable via settings. |
| Rewrite delta misleads (hidden context) | Treat as a **lower bound** on input savings; show a tooltip; never present it as exact. |
| Coefficients drift from reality | Keep them in one table in `wasteCostModel.ts`; expose `ecoprompt.wasteCost.*` overrides; unit-test. |
| Capture regressions while editing | Keep transcript (text) and chatSession (tokens) responsibilities separate; run `scripts/diag.mjs`; Rebuild+Restart the dev host. |
| Scope creep across all 6 features | Ship F1–F3 (shared engine) first; F4–F6 are independent add-ons. |
| Privacy concerns | Local-first; persist derived metrics only; never log raw prompts in telemetry. |

---

## 19. Summary of changes vs v1.0

- **Architecture corrected:** single VS Code extension (Node host + Preact webview, esbuild,
  in-process scoring/coaching, on-disk Copilot capture) — *not* Electron/PixiJS/Azure/monorepo.
- **Contracts replaced** with the real `PromptEvent` / `Score` / `Tip` / webview types.
- **Vision, scoring philosophy, pet mechanic, coach design, privacy, Microsoft alignment:** kept.
- **Dropped:** team-role assignments, video strategy, and the day-by-day delivery plan (logistics,
  not engineering).
- **Added:** the **Token Economics** layer — the real reason for this document — turning the
  existing waste score + real tokens/credits/pricing into per-prompt cost-of-waste, cumulative
  savings, per-category attribution, token trends, per-model comparison, and at-scale projection.
