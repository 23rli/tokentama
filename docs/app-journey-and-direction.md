# Token Lens — App Journey & Direction

_Last updated: 2026-07-10 · package version 0.6.10_

> **Current direction: see §10 (2026-07-07 decision — build for real-time visibility + precognition,
> no savings claim).** §9 is the pivot exploration that led here; §§1–8 are the journey and evidence.

This document records what Tokentama set out to do, what we actually built, what the
data told us (including the uncomfortable parts), and where the honest, defensible
direction lies. It is deliberately candid: several of our early assumptions did not
survive contact with real usage data, and that shaped the current direction.

---

## 1. The original vision

A friendly VS Code companion that makes the invisible cost of AI coding visible, and
helps developers **spend fewer tokens** — framed around a tamagotchi pet whose world
thrives when you prompt efficiently and wilts when you waste tokens. The core bet was:
_coach people to write leaner, clearer prompts and they'll save meaningful tokens._

## 2. What we built (the journey)

- **Scoring engine** — a deterministic 0–100 TokenScore from waste detectors
  (redundant context, retry loops, vagueness, verbosity, ignored coaching), plus a
  smoothed pet-health model and six world states.
- **Live capture** — read-only ingestion of Copilot chat sessions from disk
  (`transcripts` + `chatSessions` + `models.json`), across all windows, with real
  metered tokens/credits when present.
- **Compose box + auto-rewriter** — draft a prompt, get a live score, and an automatic
  rewrite using your own Copilot model (via `vscode.lm`, no API key) — gated so it only
  spends a model call when it's likely to help, within a per-session token budget.
- **Impact model** — tokens + Copilot AI credits (AICs) as the measured units, with
  dollars optional (never guessed), and cache-aware credit estimation.
- **Context analysis** — "where your tokens go" (system/tools/messages split),
  tool-definition advisory, and session-compaction nudge.
- **Right-sizing** — advisory to down-route trivial/moderate tasks to a lighter model /
  lower effort, with a quantified AIC/turn estimate ("escalate if it falls short").
- **Outcomes loop** — retry-rate comparison for adopted vs non-adopted coaching, netted
  against the tokens Tokentama itself spends.
- **Benchmark harnesses** — reproducible measurement, run locally:
  - `npm run bench` — synthetic multi-turn conversations.
  - `npm run bench:history` — YOUR real sessions: opportunity stack in billed AICs.
  - `npm run bench:human` — human-in-the-loop Monte-Carlo (adoption behaviour).
  - `npm run bench:cache` — infers cache efficiency from billed credits vs input tokens.

## 3. What the data told us (findings)

We measured on real Copilot sessions and with a human-behaviour simulation. The results
repeatedly contradicted the founding bet.

### 3.1 Prompt compression ≈ 0
Rewriting a prompt to be shorter saves **~0%** of a real session. The prompt text is a
sliver of a turn; the cost is the re-sent context. Compression is a rounding error.

### 3.2 Retry-avoidance ≈ 6% (real, but modest)
Clearer first prompts avoid re-asks, and a re-ask re-sends a whole turn. On real
sessions this is worth **~6%** of billed AICs. It's genuinely differentiated (Copilot
doesn't help you write the prompt before you send) but adoption-limited and shrinking as
models get better at handling vague asks.

### 3.3 Right-sizing looked big, but isn't durable
The opportunity stack put right-sizing at ~26% (real) / ~17% (human sim). Two problems:
- **It overlaps GitHub Copilot's "Auto" model routing** — where Auto is on, our advice
  is redundant.
- **Users pin premium models on purpose** ("best model = best results"). Advising a
  downgrade fights their revealed preference, so real adoption is low.
- Our difficulty classifier also over-marked turns as non-complex (it called 34/34 human
  turns down-routable), inflating the number.

Net: for the actual target user, right-sizing's durable contribution is **~0**, and it
should NOT be a headline claim.

### 3.4 Compaction is the biggest raw lever — and the riskiest
Re-sent conversation history dominates the bill, so reclaiming it is the largest raw
lever (up to ~85% as a lossless upper bound). But:
- Lossy compaction **backfires** — a dropped detail causes a wrong answer, you re-ask,
  and the whole context is re-sent again (more tokens + worse UX).
- Copilot already has **native conversation summarization**, so we're not uniquely
  differentiated here.
- **Firm principle (product):** never sacrifice coding capability for tokens. A tool
  that makes Copilot noticeably worse won't be used.

So compaction is only acceptable as **opt-in**, with a working-set recap (files by
reference, not contents — the agent re-reads on demand), a user **preview**, and a
**retry-rate guardrail** that proves capability held (back off if retries rise).

### 3.5 Human-in-the-loop simulation (the honest number)
Monte-Carlo over the real engine with human behaviour (partial adoption, retries only
_reduced_ not eliminated, ~50% follow-through on right-sizing, complex tasks never
touched, no context dropped):

| Adoption | Mean savings | p10–p90 |
| --- | --- | --- |
| 30% | 19.8% | 10–29% |
| 50% | 22.1% | 13–31% |
| 70% | 23.6% | 14–33% |

**Caveat:** ~17 of those points are right-sizing, which (per 3.3) doesn't hold for the
target user. Strip it out and the durable, defensible human number is **~5–10%**
(retry-avoidance + tool-trim), with **adoption as the dominant driver** — going 30%→90%
adoption moved the mean only ~6 points. Usability, not cleverness, gates the savings.

### 3.6 Cache analysis: the cost is structural (and mostly not user-recoverable)
Inferring caching from billed `copilotCredits` vs full `promptTokens`:

- **87% of the bill is INPUT / context** — re-sent every turn. The cost is structural,
  not behavioural.
- **Effective input rate ≈ 800–1130 AIC/1M vs a 500 base rate** — i.e. ~1.6–2.3× base.
  That points to **premium-request multipliers**, not a clean cache miss. So the raw
  "82% recoverable via caching" figure is **confounded and NOT cleanly reclaimable** —
  much of it is simply what a premium model costs to carry context.
- Token-weighted cache-hit looks like **~23%** with wide per-turn spread (some turns
  cheap/cached, many at full-or-premium price), so caching is intermittent — but we
  cannot separate "fixable cache miss" from "premium pricing" with the on-disk data.

## 4. The core realization

**Token cost in agentic coding is structural, not behavioural.** It's set by re-sent
context, tool definitions, turn count, model tier, and platform caching — none of which
a developer meaningfully controls by "prompting better." That is why chasing individual
prompt tricks felt hopeless: it _is_ a dead end.

The goal was also wrong. **Zero tokens is not the target** — good AI coding costs tokens
like a factory costs electricity, and cutting the _necessary_ spend is exactly what
degrades capability. The winnable goal is narrower:

> **Kill waste** (tokens that produce nothing) and **make spend visible** (which Copilot
> does not do), without touching model choice or the context the model needs.

## 5. What is genuinely differentiated

| Lever | Direct savings | Differentiated vs Copilot? |
| --- | --- | --- |
| Right-sizing | ~0 for target user | ❌ Auto does it / fights premium preference |
| Compression | ~0 | ❌ |
| Compaction | large but risky | ⚠️ overlaps native summarization |
| **Retry-avoidance** (pre-send prompt help) | ~6%, adoption-limited | ✅ Copilot doesn't do this |
| **Tool-trim** (flag bloated/unused tools & MCP re-sent every turn) | real, capability-safe | ✅ Copilot doesn't surface this |
| **Visibility / cost attribution** | indirect | ✅ Copilot is a black box |

Durable, non-overlapping value ≈ **6–10% of direct savings** plus the thing Copilot
fundamentally doesn't give you: **knowing what you actually spend, where it goes, and
what re-asks / bloated tools / premium pricing cost you.**

## 6. Direction

> **⚠️ Superseded by §9 (2026-07-07 senior-SWE pivot).** The visibility-first direction below
> was the pre-review plan. After the senior-SWE review we narrowed hard to a single feature —
> **pre-send prompt optimization that reduces context reload** — and are cutting the rest. Read
> §9 first; §6 is kept for history.

1. **Lead with visibility, not "save %."** Reposition from "prompt better to save tokens"
   to **"see and kill the structural waste Copilot hides."** Real per-session / per-repo
   cost, where tokens go, retry cost, tool overhead, and the premium/context split. This
   is strongest at **team/org scale**, where nobody has spend attribution today.
2. **Keep the two honest, capability-safe levers:** retry-avoidance (pre-send prompt
   help) and tool-trim. Market them as ~5–10%, not 20%.
3. **Demote right-sizing** to a quiet advisory for pinned-premium users only; stop
   implying we beat Copilot Auto on model choice.
4. **Guarded, opt-in compaction** for users who want the big lever — working-set recap
   (files by reference) + preview + retry-rate guardrail so it can never quietly degrade
   results.
5. **Obsess over adoption/UX** — the simulation shows usability gates everything. The
   compose flow must be frictionless (auto-decide, auto-clear, one-tap) and the value
   must be visible in the panel, not just the terminal.

## 7. Open questions

- Is the individual-developer market big enough given ~6–10% durable direct savings, or
  is the real product **team/org cost visibility** (FinOps for AI coding)?
- Can we cleanly separate premium-multiplier cost from fixable cache-miss cost with any
  available signal? (Currently: no.)
- Does the pet/awareness mechanic actually change habits enough to matter, or is it
  decoration on a measurement tool?

## 8. Reproduce the numbers

All local, read-only, on your own data:

```
npm run bench           # synthetic conversations
npm run bench:history   # real sessions — opportunity stack in billed AICs
npm run bench:human     # human-in-the-loop Monte-Carlo (adoption behaviour)
npm run bench:cache     # cache-efficiency inference from billed credits
```

---

## 9. Pivot — post senior-SWE review (2026-07-07)

The senior-SWE review didn't shelve the product — it **reframed and radically narrowed** it.
The verdict: everything we measured is right, but we were shipping five half-levers and a pet
instead of the one thing developers of every level actually want. Distilled advice:

1. **Cut everything extraneous.** Compaction, retry-loop detection, right-sizing, the outcomes
   loop, sustainability/CO₂, and the heavy pet mechanics are **not the product**. They're
   structural (not ours to move), platform-owned (Copilot Auto / native summarization), or
   decoration. Simplify aggressively.
2. **The product is one feature: pre-send prompt optimization that reduces context reload.**
   Re-sent context is **87% of the bill**; the only capability-safe way a *developer tool* moves
   that number is by making the prompt precise enough that the agent **loads less context to
   answer it** (fewer exploratory file reads / tool calls / wrong turns that re-send everything).
3. **Estimate the token/context load of a prompt _before_ it is sent**, and show a **more optimal
   prompt** that would load less — with the delta ("this version ≈ 40% less context to answer").
4. **Optimize with the model, not with history.** Do **not** infer from past sessions. Hand the
   draft to the user's **own model** (`vscode.lm`) and ask it, in context of the repo, how to
   phrase the ask so it needs less context — then show the **cost of that validation call**
   (bounded and known — "my token spend to validate is fixed", weigh it against the saving).
5. **Keep light, honest analytics only:** classify the **type of work** the user does
   (e.g., "80% ADO queries", "mostly 3-file refactors") so they see their own pattern, and track
   **MCP-server / commonly-used tools** as a secondary, org-relevant metric. Nothing else.

### 9.1 The headline feature — "Context-load preview & optimize"

The reframe that makes this defensible: **prompt optimization _in the context of context_.** We
stop optimizing the prompt's *wording* (a rounding error, §3.1) and start optimizing the
**context load the prompt triggers**.

Flow (all pre-send, in the compose box):
1. User drafts a prompt.
2. On demand (one tap), we send the draft + a compact repo signal to the user's own model with a
   meta-ask: _"To answer this, what would you need to load — which files, how many exploratory
   tool calls — and how could the prompt be rewritten to need less?"_
3. We show: **estimated context load of your prompt** (files it will make the agent open /
   explore) vs. **the optimized prompt's estimated load** (you named the files/scope up front, so
   no exploration), the **token/AIC delta**, and the **cost of this validation call** so the net
   is always visible and honest.
4. One tap to copy the optimized prompt into Copilot.

Why this targets the real money: a vague prompt makes the agent explore, and everything it opens
becomes context that is **re-sent on every subsequent turn**. Pinning the context in the prompt
(right files, right scope, expected output) cuts the *recurring* reload, not just this turn.

### 9.2 Keep / cut / defer

| Keep | Cut | Defer |
| --- | --- | --- |
| Compose box + model rewrite (`vscode.lm`) | Compaction feature + nudge | Pet — demote to a tiny status glyph, not a world |
| **New:** pre-send context-load estimate + optimize | Retry detection / outcomes loop | — |
| Real cost visibility (tokens / AIC) per prompt | Right-sizing advisory | — |
| **New:** work-type classifier (light analytics) | Sustainability (Wh / CO₂e) | — |
| MCP-server / common-tool tracking (secondary) | Human/Monte-Carlo sim in the UI | — |

### 9.3 Why this is defensible (all levels of SWE)

- **Capability-safe by construction:** a clearer, better-scoped prompt gets a *better* answer,
  never a worse one. We never drop context the model needs — we help the user not *summon* context
  it doesn't.
- **Forward-looking, not history-based:** the model reasons about *this* prompt in *this* repo, so
  it works on turn one and for any task — no cold-start, no per-user training corpus needed.
- **Hits the 87%, not the sliver:** context reload is the bill; this is the only user-controllable
  input to it.
- **Honest net:** the validation-call cost is always shown against the estimated saving.

### 9.4 Open technical questions (to validate next)

- **Can the model reliably estimate context load pre-send?** Needs a probe: for N real prompts,
  compare the model's predicted files/tool-calls vs. what the session actually loaded.
- **Is the optimized prompt's realized saving real?** A/B a sample: send original vs. optimized,
  measure actual context tokens loaded per task.
- **What repo signal is enough** to make the estimate good without itself being expensive to send?
- **Does the validation cost stay well below the saving** across task types?

### 9.5 Phased plan

1. **Probe first (measure before building):** a script that, for real past prompts, asks the model
   to predict context load and proposes an optimized prompt, then compares predicted vs. actual —
   proves the estimate is trustworthy before we ship UI. *(Same discipline as every prior claim.)*
2. **Simplify the codebase:** remove/park compaction, retry, right-sizing, outcomes, sustainability,
   and heavy pet mechanics behind the single compose→optimize flow.
3. **Ship "Context-load preview & optimize"** in the compose box with the honest net panel.
4. **Add the work-type classifier** and MCP/common-tool metrics as light analytics.

### 9.6 Probe result (2026-07-07) — ⚠️ the simple premise is NOT supported

Ran the probe (`npm run probe:context`, `scripts/probe-context.ts`) over **8 real sessions,
337 prompted turns, 3,173 tool calls** — measuring, per turn, whether a prompt names a concrete
target (file/path/backtick/code) and how much context it then loaded (discovery+read tool calls
and real `promptTokens`). The bet was: **specific prompts load less context.** The data says
otherwise:

| Cohort | Turns | Context-load calls/turn | real promptTokens/turn |
| --- | --- | --- | --- |
| **Specific** (names a target) | 31 (9%) | **16.84** | 344,905 |
| **Vague** | 306 (91%) | **2.83** | 385,609 |

- **Wrong direction on tool calls:** "specific" prompts triggered *more* exploration (r = **+0.28**),
  not less. Reason: **specificity tracks task _size_, not scoping efficiency.** Prompts that paste
  code / name files are usually the big refactor/debug tasks that inherently need lots of reading.
- **Phrasing ↔ real context size ≈ 0:** correlation of specificity signals with `promptTokens` is
  **r = −0.06** — essentially nothing. This **reproduces the structural wall** (§4): the bill is set
  by task complexity, not prompt wording.
- **The recoverable slice is small:** pure *discovery* (the agent hunting because the prompt didn't
  say where) is only **~10% of tool calls**; the bulk of "context load" is *reading files it must
  read to do the work* — task-driven, not phrasing-driven.

**Honest read:** the literal pivot ("optimize the prompt → less context reload") is **not supported
by this data** — the same structural result that sank the earlier theses shows up again. Caveats
worth stating to the senior SWE: (a) the text classifier is crude and confounds "specific" with
"large"; (b) it's cross-sectional (different tasks), so it can't isolate the *same-task* question —
"for one task, does a better-scoped prompt cut the *discovery* calls?"; (c) n=31 specific is small;
(d) the model-prediction half is untested. But even isolating discovery, "specific" prompts had
*more* of it — so the confound doesn't rescue the premise. **Recommendation: do not build the UI
yet.** Either design a within-task A/B (same task, scoped vs. vague prompt, measure realized load)
to get a clean number, or accept that this lever is also structural and move to the shelve/again
decision. The probe did its job: it stopped us building on an unproven assumption.

### 9.7 Viability probe (2026-07-07) — size-controlled, and the answer is no

To remove the size confound, the second probe (`npm run probe:viability`,
`scripts/probe-viability.ts`) used the **tool-call arguments** (real file paths, captured in
`tool.execution_start`) to ask the sharp, size-controlled question: **at equal footprint (same
number of files touched), does the prompt _naming_ the target file eliminate the agent's hunting
(discovery calls)?** Corpus: **10 sessions, 360 turns, 2,878 tool calls with file args.**

Two findings, both decisive:

1. **People don't name files — 3%.** Of the 221 turns that actually touched a file, the prompt
   named a touched file in **only 7 (3%)**. This is the whole point of agent mode: you describe the
   task and let the agent find the files. The optimizer's core move ("add the target file to your
   prompt") **fights the exact reason people use agent mode** — so even a perfect optimizer has
   almost no behaviour to improve.
2. **The recoverable slice is tiny — 12%.** Discovery/hunting is **337 of 2,878 tool calls (12%)**;
   the other 88% is reading files the agent *must* read to do the work, plus the edits themselves —
   task-driven, not phrasing-driven. **12% is the absolute ceiling** for this lever, before adoption.

The size-controlled comparison couldn't even run cleanly: the "named-target" cohort was 7 turns
(and 6 of them were big 7+-file analysis tasks that named files *and* hunted heavily), while the
2–3 and 4–6 file buckets had **zero** named-target turns. There is no population to show an effect
on. Caveat: naming detection is extension-based (requires a `.ts`/`.py`/… token), so it undercounts
symbol/component references ("the `DashboardViewProvider`") — but the **12% discovery ceiling is
robust regardless**, and the 3% naming rate would still be low even if doubled.

**Verdict: the pivot lever is not viable.** It's capped at ~12% *and* requires a behaviour (naming
targets) that contradicts why people use agent mode. Combined with §3–§4 and §9.6, the conclusion is
consistent across every test we've run: **context cost is structural and task-driven; no prompt-side
developer tool moves it meaningfully.** The one theoretical escape — the tool *auto-injecting* likely
files instead of asking the user to name them — collapses into what the agent's own search already
does, and doing it wrong *adds* context. **Recommendation to the senior SWE: this is a genuine
shelve (option D), or a scope change away from "saving tokens" entirely** (e.g. pure visibility /
work-type analytics as a lightweight utility, with no savings claim).

---

## 10. Decision (2026-07-07) — build for real-time visibility + precognition

The senior SWE reviewed the three probes and agreed: **you can't influence context tokens via
optimized prompts — savings don't exist.** The decision is **not** to shelve, but to **change scope
away from saving tokens**: build the tool purely for **real-time visibility** and **precognition**,
with **no savings claim**. His words: _"real-time visibility is something we don't have yet."_ This
is the one thread that survived every test (the honest survivor in §5/§6) — GitHub gives you a bill,
never a live, per-turn, where-it-went view while you work.

### 10.1 What we're building (two honest things)

- **Real-time visibility** — a live meter of what the *current* Copilot session is spending, updated
  as you work: cumulative tokens + AIC (and $ if a rate is set), **per-turn cost**, and **where the
  tokens go** (system / tool-definitions / conversation-history / your-message), with the
  re-sent-context share called out. Real metered numbers when present, clearly-labelled estimates
  otherwise. This is descriptive, always-true, and needs no behaviour change.
- **Precognition (forecast, not savings)** — before/as you send, show the *trajectory*: "your context
  is ~380k tokens; each further turn will cost ≈ X AIC and it grows ~Y per turn." An honest heads-up
  about the cost you're *about* to incur, framed as awareness — **never** as "do this to save." It's
  the thing nobody shows you: the running meter and its slope.

### 10.2 Keep / cut under the visibility framing

| Keep (this IS the product now) | Cut (savings-era scaffolding) |
| --- | --- |
| Live capture (`CopilotWatcher`, readers, parsers) | Scoring engine / waste detectors / TokenScore |
| Impact model (tokens + AIC, cache-aware) | Compose box + auto-rewriter / coaching / corpus |
| Context breakdown (where tokens go) | Right-sizing, retry-avoidance, compaction, outcomes |
| Status bar → live cost meter (not a pet score) | Sustainability (Wh / CO₂e) |
| Dashboard → live session cost + breakdown + forecast | Pet world / six states (demote to nothing, or a tiny glyph) |
| **New:** per-turn forecast (precognition) | Human/Monte-Carlo sim in the UI |
| Light work-type analytics (secondary) | Any "% saved" claim anywhere |

### 10.3 MVP (first shippable slice)

A single sidebar panel + status bar that shows, for the **live session**:
1. **Session cost so far** — tokens, AIC, ($ if configured), real-vs-estimated labelled.
2. **Per-turn list** — each turn's cost + a one-line where-it-went.
3. **Where the tokens go** — system / tools / history / message split for the latest turn.
4. **Forecast** — projected cost of the next turn and per-turn growth rate.
5. Status bar shows live session AIC + a click-through to the panel.

No scoring, no rewrite, no pet, no savings language anywhere.

### 10.4 Plan

1. **Reframe the contract + UI** to cost/visibility (drop score/waste/pet fields from the view model).
2. **Delete the savings-era modules** (scoring, coaching, rewriter, right-sizing, retry, compaction,
   outcomes, sustainability, pet world) — as agreed, remove entirely, not park.
3. **Promote capture + impact + context** to the front of the dashboard as the live meter.
4. **Add the forecast** (precognition) from the session's real per-turn token/credit trajectory.
5. **Rename/reposition** away from "spend fewer tokens" to "see what you spend, live."
6. Keep everything **local, read-only**; keep the honest real-vs-estimate labelling.

### 10.5 Forecast accuracy — validated first (2026-07-07)

Before any UI, built the forecaster (`src/analysis/forecast.ts`) + an accuracy harness
(`npm run bench:forecast`) and ran it on real sessions (**7 sessions, 260 predictions**). Each turn
N is predicted from turns 0..N-1 + turn N's prompt, then compared to the **real metered
`promptTokens[N]`**:

| Model | Median APE | within ±10% | within ±20% | within ±30% |
| --- | --- | --- | --- | --- |
| **Structural** (carried + learned growth + draft) | **3.6%** | 75% | **89%** | 92% |
| baseline: last-value | 4.1% | 73% | 88% | 93% |
| baseline: EMA-delta | 3.5% | 77% | 88% | 90% |

**Accuracy score: 96.4/100** (100 − median error); **~90% of turns land within ±20%.** Good enough
to show. Two honest caveats to keep on the record:
- **Structural barely beats "it'll cost about the same as last turn."** Next-turn input ≈ last-turn
  input because context grows slowly, so last-value is already strong. That's not a failure — it's
  the **same structural truth as a feature**: the meter and its slope are predictable, and the draft
  prompt is a rounding error against carried context (the forecast literally shows your prompt is
  ~0.1% of the bill). Honesty is the product.
- **Mean error is high (MAPE ~37%) from a minority of regime-change turns** (new conversation,
  native summarization, a huge tool dump). Those jumps aren't predictable pre-send, so the UI must
  **surface confidence** and stay quiet/hedged when recent variance is high (the forecaster already
  emits a `confidence` 0..1). Re-run `bench:forecast` after any change to guard against regressions.

### 10.6 Pushing for "accurate every time" — where the error lives, and can an AI model / the prompt help? (2026-07-07)

Deeper diagnostics (`npm run bench:forecast:lab`, 9 sessions, 270 predictions) segmented the error:

| Turn type | Share | Median error | within ±20% |
| --- | --- | --- | --- |
| **steady** | 77% | **2.6%** | 94% |
| **surge** (context jumps up) | 21% | 12.1% | 71% |
| **reset** (summarization collapses it) | 3% | **1221%** | 0% |

So "accurate every time" as a single number is **impossible** — resets are a ~20× collapse and
surges are big jumps. The honest form of the goal is a **calibrated interval + a reset flag**:
- The forecaster now emits an **interval [low, high]** (calibrated to the observed actual/predicted
  spread, p05≈0.77 / p95≈1.21). Measured coverage: **~93% of turns land inside it.**
- It emits **`resetRisk: 'high'`** near the context ceiling (where native summarization fires) and,
  instead of a false number, the UI shows "summarization likely." *Tuning note:* the current zone
  still over-flags (catches 6/7 resets but flags ~160 turns); needs tightening so it flags only the
  true edge. Open item.
- Cost is **0 tokens, ~12 µs/prediction — pure local arithmetic, free.**

**Can an AI model or the prompt improve it?** We tested this head-on (`npm run bench:forecast:prompt`,
254 non-reset turns) — does the prompt text predict the growth a turn generates?

| Signal → growth correlation | r | R² (variance explained) |
| --- | --- | --- |
| prompt length / code / explore-verbs / edit-verbs / files | **≈ 0** (max 0.09) | **~1%** |
| prompt "scope" words (all/entire/codebase…) | 0.09 | ~1% |
| turn's actual tool-call count (post-run) | 0.20 | ~4% |

Surge rate is **25% with explore/scope words vs 20% without** — no real lift. **Verdict: the prompt
carries almost no signal for how hungry a turn will be** (~1% explanatory ceiling), so:
- **An AI model would NOT help.** A model can only exploit signal that exists; at a ~1% ceiling it
  would spend real tokens per prediction to recover essentially nothing — a terrible token-to-result
  ratio, and it would turn today's **free, 0-token** forecaster into a paid one for no accuracy gain.
- **"Taking the prompt into account" doesn't move accuracy** — we measured it directly (r≈0). It's
  the same structural truth yet again: a turn's cost is driven by accumulated context + semi-random
  agent tool exploration, **not** by the prompt's wording or apparent intent. (A short "continue"
  can trigger a huge exploration; a detailed ask can hit cache and be cheap.)

**What actually gets us closer to "always right," and stays free:**
1. Keep the **calibrated interval** as the headline (it's the honest "every time" — ~93% coverage).
2. **Tighten the reset flag** so it fingers only the true near-ceiling edge (open item above).
3. Optionally fold the **post-run tool-call count** (r=0.20, free) into the *next* input forecast —
   small win, no tokens. Not worth an AI call; possibly worth the plumbing.

Bottom line for the product: **the forecast is already near its achievable ceiling for free.** Push
precision via the interval + reset flag, not via an AI model. Spend model calls (if ever) on the
*visibility narrative*, not on trying to out-predict a structurally unpredictable surge.

### 10.7 Is the arithmetic fragile across models? — made self-calibrating + stress-tested (2026-07-07)

Fair concern: the forecaster was validated on ONE setup (Claude Opus, ~1M context). Others use Auto,
smaller windows, different tokenizers. We separated the model-agnostic core from the fragile
constants and fixed the latter:

- **Already model-agnostic (kept):** `carriedContext` uses the **real metered** `promptTokens` /
  `completionTokens` read from disk (any model), and `learnGrowth` learns each session's growth from
  its **own** residuals. No per-model tuning.
- **Was fragile → now self-calibrating:** the interval `0.77/1.21` is now **derived from each
  session's own actual/predicted spread** (scale-free ratios, so tokenizer/window-invariant); the
  reset threshold is no longer an absolute `60k` — it's **model-relative**, using the real
  `maxInputTokens` (auto-detected **935,793** on this machine) and/or the session's own observed
  summarization trigger, whichever is earlier. No absolute constant remains.

**Stress test** (`npm run bench:forecast:robust`) transforms the real sessions into synthetic
"other-model" regimes and compares the adaptive forecaster to a static one (old fixed interval +
absolute 60k reset):

| Regime | Adaptive (MdAPE / cover / flagged) | Static (MdAPE / cover / flagged) |
| --- | --- | --- |
| identity | **3.9% / 89% / 9%** | 34% / 50% / 97% |
| small-window ×0.15 (128k-class) | **4.0% / 88% / 9%** | 7% / 83% / 50% |
| large-window ×2.0 | **3.9% / 89% / 9%** | 52% / 0% / 99% |
| diff-tokenizer ×0.7 | **3.8% / 88% / 3%** | 31% / 44% / 94% |
| volatile-harness (±35% noise) | 24% / 69% / 47% | 59% / 11% / 97% |

**Read:** the adaptive forecaster is **flat across tokenizer scale and context window** (~3.9% error,
~88% coverage everywhere) — precisely the axes that differ between models. The static version breaks
(it even flags **97% of the user's own real turns** — proof the old constant was overfit). Under a
genuinely erratic harness (±35% per-turn noise) accuracy drops to 24%, but it **degrades gracefully
and still doubles the static version**, and the confidence/flag signals correctly light up. Covered
by 5 new unit tests (`forecast.test.ts`, 11 total green). **Caveat:** these are one dev's sessions
transformed — real multi-user data is the final proof, but the design no longer hard-codes anything
model-specific. **How it "tracks" a new model:** it reads that model's real metered tokens + limit
from disk and self-calibrates; a brand-new model's *first* summarization reset is the only thing it
can't preempt (nothing on disk predicts it yet) — after one, it learns that model's trigger.

### 10.8 Deep accuracy analysis — how far can the point estimate go? (2026-07-08)

**How the model works (the mechanism).** A turn's input is an exact identity:
`promptTokens[N] = promptTokens[N-1] + completion[N-1] + toolResults[N-1] + draft[N]`. When you're
about to send turn N, three of those four terms are **already metered on disk** — the prior input,
the prior answer, and your draft's text. The **only** unknown is `toolResults[N-1]` (how many tokens
the last turn's tool outputs added to history). So the entire forecasting problem reduces to
**estimating that one term**, which we call `growth`. That's why the forecast is so accurate on
steady turns (2.6%) and only wobbles on surges (a turn whose tool output was unusually large).

**Can we improve it?** Tested seven growth estimators head-to-head on real turns
(`npm run bench:forecast:improve`, 273 non-reset predictions):

| estimator | overall MdAPE | steady | surge | surge within ±20% |
| --- | --- | --- | --- | --- |
| median (was current) | 3.8% | 2.7% | 12.1% | 71% |
| **tool-count-scaled** | **3.3%** | 2.6% | 11.9% | 69% |
| blend `max(median, toolcount)` (**adopted**) | 3.4% | 2.6% | 11.6% | 69% |
| ema / recent3 / last | 4.5–4.6% | worse | ~13% | 62–69% |

**Adopted:** the growth term now scales by the **prior turn's tool-call count** (learned per-tool
token rate), blended as a floor with the median so a noisy early rate can't underestimate. It's
**free** (tool counts are already on disk) and cuts overall median error **~13% (3.8%→3.3–3.4%)**,
mostly on steady turns. `TurnHistory` gained an optional `toolCalls` field; 2 new unit tests; falls
back to the plain median when tool data isn't supplied. Backward compatible.

**The honest ceiling — why surges stay ~12%.** Growth is driven by tool **output size**, but that is
**not stored anywhere on disk** — verified: `tool.execution_complete` records only `success`, no
content; there is no tool-result event. Tool **count** is only a weak proxy (r=0.20, R²~4%), because
one `read_file` of a huge file dwarfs ten `grep`s. So no free method can meaningfully predict a
surge's magnitude before it happens. **Conclusion:** the point estimate is at its achievable ceiling
(~3.3% median, free); for surges the **calibrated interval + reset flag are the honest answer**, not
a falsely-confident number. An AI model can't help here either — it would need the tool outputs,
which don't exist until the turn runs. The remaining accuracy story is *presentation* (lead with the
interval, hedge on low confidence), not a better predictor.

### 10.9 Can we get the tool call? (and the MCP question) — 2026-07-08

Fair worry: this dev uses almost no MCP servers, but MCP-heavy users have big, variable tool outputs
that would swing the forecast. So — is tool information recoverable, and does it fix surges? We dug
into the `chatSessions` patch log (which the UI uses to render tool calls). What's there per tool
call (`toolInvocationSerialized`):

- **tool identity** (`toolId`, e.g. `copilot_readFile`),
- the **file URIs** it touched (+ line range in the transcript args),
- **`source: {type, label}`** — which distinguishes **"Built-In" from external/MCP** tools.

What's **not** there: the raw tool **output** (only `success` is logged). So we tried to *reconstruct*
read sizes by reading the touched files from the workspace (`npm run bench:forecast:toolsize`):

| signal → growth | r | R² | MdAPE with it |
| --- | --- | --- | --- |
| reconstructed file-read tokens | 0.16 | 3% | 3.6% |
| tool-call count | 0.19 | 4% | 3.3% |

**Reconstruction does NOT beat tool count** — because context isn't additive (a file already in
context isn't re-sent, the harness caches/dedupes/truncates, and files drift after the session). So
tool output remains structurally unpredictable, even with the URIs.

**But this is the good news for MCP users, in three parts:**
1. **The forecaster already self-adapts to any tool mix.** The adopted growth term learns a
   *per-tool token rate from each session's own history* (`median(residual / toolCalls)`). An
   MCP-heavy user whose tools return huge payloads produces large residuals → a large learned rate →
   proportionally larger forecasts. No MCP-specific tuning; it calibrates to their data automatically
   (same self-calibration proven model-agnostic in §10.7).
2. **We can now DETECT MCP usage** via `source.type` and count built-in vs external tool calls per
   turn — so MCP-heavy turns can carry an explicit *higher-uncertainty* signal (wider interval /
   lower confidence) instead of a false-confident number. (Ready to wire; unvalidated here because
   this machine has no MCP data.)
3. **The interval absorbs the volatility.** MCP outputs make growth more variable, and the interval
   is self-calibrated to each session's spread — so it simply widens for a jumpy MCP user, keeping
   coverage honest rather than breaking.

**Net:** we can get the tool call *metadata* (identity, files, built-in-vs-MCP) but not its output.
That's enough — the model adapts to MCP-heavy usage by learning the per-tool rate, and flags the
extra uncertainty; it does not need to measure MCP output to stay honest. Real MCP-user data is the
outstanding validation.
