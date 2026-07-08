# Tokentama — Decision Brief (for senior-SWE review)

_Prepared 2026-07-06 · refreshed 2026-07-07 with a fresh run on real session data.
Self-contained: readable without prior context. Candid by design._

> **TL;DR for the 5-minute version:** I built a token-saving tool for AI coding and
> measured it hard on my own real Copilot sessions. The uncomfortable result: **~82–87%
> of the bill is re-sent context ("input"), not prompting behaviour.** The one honest,
> capability-safe lever I can move as a *developer tool* is **retry-avoidance ≈ 5%**.
> Everything bigger (right-sizing, tool-trim, compaction, caching) is either **structural
> / harness-controlled**, **already shipped by GitHub**, or **~0 for a clean setup like
> mine**. I think it's a dead end as a savings product. Questions in §8.

## 0. The ask (read this first)

Tokentama is a VS Code extension that tries to help developers **spend fewer tokens** on AI
coding (GitHub Copilot). After building it out and testing extensively on **real Copilot
session data**, I've concluded it's **probably a dead end as a token-saving product** — the
savings are small, structural, adoption-gated, and mostly overlap features GitHub already
ships or is actively building. I want a second opinion on: **is there a real product here,
and if so which direction — or do we shelve it?** The specific questions are in §8.

---

## 1. What it is / the original premise

A friendly VS Code sidebar tool with a tamagotchi pet whose world thrives when you prompt
efficiently and wilts when you waste tokens. The founding bet: **coach developers to write
leaner, clearer prompts and they'll save meaningful tokens.**

## 2. What we built

- Deterministic prompt **scoring engine** (waste detectors: redundancy, retry loops,
  vagueness, verbosity) + a pet-health model.
- Read-only **capture** of Copilot chat sessions from disk (transcripts + chatSessions +
  models.json), with real metered tokens/credits.
- **Compose box + auto-rewriter** using the user's own Copilot model (`vscode.lm`), gated so
  it only spends a model call when likely to help, within a per-session token budget.
- **Impact model** in tokens + Copilot AI credits (AICs), $ optional, cache-aware.
- **Context analysis** (where tokens go: system/tools/messages), tool advisory, compaction
  nudge; **right-sizing** advisory with quantified AIC/turn; **outcomes** loop.
- Four **local benchmark harnesses** (reproducible, on real data): `bench`, `bench:history`,
  `bench:human`, `bench:cache`.
- ~136 unit tests, packaged VSIX (v0.1.2), pushed to two remotes.

---

## 3. Findings (the meat — measured, not guessed)

### 3.1 Prompt compression ≈ 0
Shortening prompt wording saves ~0% of a real session. Prompt text is a sliver of a turn.

### 3.2 Retry-avoidance ≈ 6% (real but modest)
Clearer first prompts avoid re-asks (a re-ask re-sends a whole turn). Worth ~6% of billed
AICs on real sessions. Differentiated (Copilot doesn't help pre-send) but adoption-limited
and shrinking as models handle vague prompts better.

### 3.3 Right-sizing looked big (~17–26%) but isn't durable
- Overlaps **GitHub Copilot "Auto"** model routing (redundant where Auto is on).
- Users **pin premium models on purpose** ("best model = best results"); advising a downgrade
  fights their revealed preference → low adoption.
- Our difficulty classifier over-marked turns as down-routable, inflating the figure.
- **Durable contribution for the target user ≈ 0.**

### 3.4 Compaction is the biggest raw lever — and the riskiest
Re-sent history dominates the bill, so reclaiming it is the largest raw lever (up to ~85% as
a *lossless* upper bound). But lossy compaction **backfires** (a dropped detail → wrong answer
→ re-ask → whole context re-sent again), Copilot already has **native summarization**, and our
firm rule is **never sacrifice coding capability for tokens**. So it's only acceptable as
opt-in, with a working-set recap, a preview, and a retry-rate guardrail.

### 3.5 Human-in-the-loop simulation (the honest headline number)
Monte-Carlo over the real engine with human behaviour (partial adoption, retries only reduced,
complex tasks never touched, no context dropped):

| Adoption | Mean savings | p10–p90 |
| --- | --- | --- |
| 30% | 19.8% | 10–29% |
| 50% | 22.1% | 13–31% |
| 70% | 23.6% | 14–33% |

**But** ~17 of those points are right-sizing (which doesn't hold per §3.3). Strip it out and the
durable, defensible number is **~5–10%**, with **adoption as the dominant driver** (30%→90%
adoption moved the mean only ~6 points — usability, not cleverness, gates savings).

### 3.6 The cost is structural (fresh cache/pricing evidence, 2026-07-07 run)
From real `models.json` (claude-opus-4.x) — AIC per 1M tokens:

| Fresh input | Cache **read** | Cache **write** | Output |
| --- | --- | --- | --- |
| 500 | 50 | **625** | 2500 |

Re-running `bench:cache` today across my real sessions (86,086 AIC billed):

- **87% of the bill is input/context** (75,074 of 86,086 AIC) — re-sent every turn.
- **Token-weighted cache-hit ≈ 22%** of input; the rest is paid at or above full price.
- Measured **effective input rate ran 799–1115 AIC/1M** per session — *at or above* the 500
  fresh rate. Explanation: **cache-write churn** — when earlier context changes/reorders it
  must be re-*written* at **625 (more than fresh input)** instead of cheaply re-read at 50.
- Inferred "cache-miss waste" looks like **70,499 AIC (82% of the bill)** — but it is
  **confounded by premium-request multipliers**, so it is **NOT cleanly reclaimable**. Much of
  it is simply what a premium model costs to carry context. All of it is controlled by the
  **agent/harness assembling context — not by the user.**

### 3.7 The tool-config wedge — real in theory, ≈0 for this user (with numbers)
Tool *definitions* (the JSON schema for every callable tool, re-sent on **every** turn) are a
meaningful slice of the fixed prefix. In today's `bench:history` run, the **tool-trim lever**
(assuming ~30% of tool defs are unused/disable-able) came out at:

| Session | Tool-trim AIC | % of that session's bill |
| --- | --- | --- |
| 76006030 | 2,536 | 9% |
| b2df490a | 1,505 | 9% |
| c60a8008 | 2,177 | 11% |
| c6a06567 | 1,748 | 11% |
| c3ed9e9c | 203 | 6% |

So *in the abstract* tool definitions are worth **~6–11%** — and trimming **unused** ones is
capability-safe and org-actionable. **But which tools were actually costing me this?**
- I checked this user's config: **zero MCP servers** (`settings.json` is ~4 lines; no `mcp.json`
  anywhere in the workspace or user profile).
- Therefore every re-sent tool definition is a **built-in Copilot agent tool** — `read_file`,
  `create_file`, `replace_string_in_file`, `run_in_terminal`, `grep_search`, `file_search`,
  `list_dir`, `semantic_search`, etc. These are **core to agent mode**: disabling them breaks
  the agent. **None are trimmable.**
- **Recoverable tool loss for this user ≈ 0.** The 6–11% is real spend but not *waste* — it
  buys the agent's capability. The wedge only becomes recoverable for **MCP-heavy** users who
  load servers/tools they rarely call — **unvalidated; needs other people's data.**

### 3.7a Plain-English: what "the wedge" is, and why it matters
(You asked me to nail this down.) **The wedge = billed cost − the cost of the minimal necessary
context at perfect caching.** It is created by three structural things, none behavioural:
1. **Re-sent context that isn't cached** (cache-write churn): 87% of the bill is input, and only
   ~22% of it is actually being read from cache. The rest is re-paid every turn.
2. **Tool definitions re-sent every turn** (§3.7): the fixed prefix you carry on all 200+ turns.
3. **Premium-request multipliers**: pinned premium models push the effective rate above base.

**How the app tracks it** with on-disk data: `chatSessions` gives real `promptTokens` /
`copilotCredits` / per-category `promptTokenDetails`; `models.json` gives the real rate card. We
infer the wedge as *billed AIC vs. what the same tokens would cost at the cached rate*. **Why it
matters:** the wedge is **82% of the bill** — huge — but the audit shows it's **mostly not
user-recoverable**: churn is harness-controlled, the tools are built-in, and the premium rate is
a deliberate user choice. So the wedge is a great *diagnostic* and a poor *product lever* for an
individual dev. It only becomes actionable at **org scale** (fleet-wide MCP bloat, model
defaults, harness config) — which is a platform/FinOps play, not a prompt-coach.

### 3.8 GitHub already owns the org story
GitHub's Copilot **metrics API** gives enterprise/org/team/user usage + engagement + billing,
**but no per-repository and no token-level / "where the tokens go" breakdown.** It's **new
(Oct 2025), actively expanding**, and GitHub owns the **authoritative billing data** (our numbers
are inferred and less accurate). So the visibility gap is **real but narrow, shrinking, and high
platform-risk.**

---

## 4. Why it looks like a dead end

1. **Token cost is structural, not behavioural** — set by re-sent context, tool definitions,
   turn count, model tier, and platform caching. A developer can't meaningfully move any of these
   by "prompting better." Chasing prompt tricks is a genuine dead end.
2. **The goal was also wrong** — zero tokens isn't the target; good AI coding costs tokens like a
   factory costs electricity. Cutting *necessary* spend is exactly what degrades capability.
3. **Adoption gates everything** — the one thing that moves savings is people actually using the
   tool, and the durable levers are small enough that they won't bother.
4. **Platform risk** — GitHub owns the data and is building observability; the individual levers
   overlap Copilot Auto + native summarization.
5. **For this user specifically, every surviving lever ≈ 0** (no MCP to trim; premium by choice;
   Auto handles routing; cache churn is harness-controlled).

## 5. What actually survives (with caveats)

| Thread | Real? | Fatal caveat |
| --- | --- | --- |
| Retry-avoidance (pre-send prompt help) | ~6% | adoption + compose-box friction (can't read Copilot input live) |
| Tool-trim (unused MCP) | real for MCP-heavy | ~0 for clean setups; unvalidated on others |
| Visibility / cost attribution | genuine gap | GitHub is building it; platform risk; our numbers inferred |
| Cache-write-churn reduction | biggest real cost | controlled by the harness, not the user |

## 6. Strategic options (for discussion)

- **A. Org/FinOps pivot** — "see per-repo/per-team AI spend + centrally-fixable waste (unused
  MCP, model defaults) GitHub doesn't show." Bigger, harder (telemetry backend, privacy/security,
  B2B sales), high platform risk, needs metadata-only (prompts are sensitive).
- **B. Niche pre-send + tool-trim tool** — honest ~5–10%, sold to MCP-heavy teams. Small.
- **C. Awareness/culture tool** — lean into the pet as a habit/awareness nudge, drop the savings
  claim. Soft, unproven.
- **D. Shelve it** — accept the token-saving thesis doesn't hold and stop.

## 7. My honest lean

The token-saving product is **not there**. The only intellectually honest "product" candidates
are **org-level visibility of the structural waste GitHub hides** (option A — but big, risky, and
GitHub may close the gap) or **shelving it** (option D). Options B/C are too thin to justify
continued effort. I lean D unless the senior SWE sees an angle I'm missing.

## 8. Questions for the senior SWE

1. Is there a durable business in **~5–10% individual savings** that's mostly adoption-gated? (I think no.)
2. Is **org AI-spend visibility** a real market, or does GitHub's expanding metrics API kill it
   before we start? How do you weigh **platform risk** when building on a vendor's black box?
3. Is the **tool-config waste** (~⅓ of bill on definitions) worth validating on MCP-heavy users,
   or is "disable unused MCP servers" too niche/too obvious to be a product?
4. Given token cost is **structural + adoption-gated**, is there *any* framing where a developer
   tool changes it — or is this inherently a **platform/harness** problem (i.e. not ours to solve)?
5. If it's a dead end as savings: is the **measurement/awareness** angle (or the pet as a
   behavioural nudge) worth anything, or do we shelve and take the learnings?

---

## Appendix — reproduce the numbers (all local, read-only)

```
npm run bench           # synthetic multi-turn conversations
npm run bench:history   # real sessions: opportunity stack in billed AICs
npm run bench:human     # human-in-the-loop Monte-Carlo (adoption behaviour)
npm run bench:cache     # cache-efficiency inference from billed credits
```

Key technical facts:
- Data source: `%APPDATA%/Code/User/workspaceStorage/<hash>/GitHub.copilot-chat/` — `transcripts`
  (prompts + tool calls), `chatSessions` (real promptTokens/completionTokens/copilotCredits +
  per-category `promptTokenDetails`), `debug-logs/<id>/models.json` (real pricing) + `main.jsonl`.
- Pricing (models.json, AIC/1M): input 500 · cache-read 50 · cache-write 625 · output 2500.
- Fresh 2026-07-07 run — `bench:history`, 5 longest sessions (47–69 turns), **238 metered turns,
  83,766 AIC billed**: retry-avoidance + compression saved **4,622 AIC (5%)**; capability-safe
  recoverable (bundles retry + right-size + tool-trim) **32,065 AIC (38%)** — but strip the
  levers that don't hold (right-size, tool-trim) and the **durable, honest number is retry ≈ 5%**.
  Task mix: **0 trivial · 197 moderate · 82 complex (29% complex, untouched)**. Compaction upper
  bound **71,780 AIC (86%, lossless, opt-in only)**.
- Fresh 2026-07-07 run — `bench:cache`, 86,086 AIC billed: **87% input**, token-weighted
  cache-hit **~22%**, effective input rate **799–1115 AIC/1M** (≥ base → churn/premium, not clean
  cache miss).
- Caveat throughout: **one developer, one machine** — not representative. Any org claim needs
  multi-user data.
