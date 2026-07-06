# Tokentama — App Journey & Direction

_Last updated: 2026-07-06 · package version 0.1.2 · 136 unit tests green_

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
