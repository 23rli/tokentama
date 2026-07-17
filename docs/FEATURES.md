# Token Lens — Local Personal AI Usage Ledger

_A private, durable source of truth for one developer's local AI usage, with GitHub Copilot Chat as the first adapter and live forecast._

Everything is **read-only** and **local**. Durable records are metadata-only and retained until explicitly cleared. There is no cloud service or automatic upload.

---

## 1. Personal ledger and scope model

The local ledger is append-only and stored under VS Code's global extension storage. Source adapters emit versioned content-free observations; rescans and late metering become revisions of one logical record rather than duplicate usage.

The **Overview** offers Today, 7 days, 30 days, and All. It breaks known usage down by application, provider/model, and local project alias, and separately shows fully metered, input-only, output-only, genuinely in-flight, and usage-unavailable coverage.

By default, a folder window is scoped to **that folder's VS Code workspace storage**. The optional `all` scope deliberately aggregates every window, while an empty window can only approximate isolation from chats touched after it opened. Within that, four scopes appear across the UI:

| Term | Meaning |
|---|---|
| **This prompt** | The single latest turn (one message). |
| **Context window** | What Copilot has loaded *right now*. This is the only thing that **resets** — it drops when Copilot auto-summarizes near the model's limit. |
| **This chat** | The current conversation, summed across its turns (cumulative). |
| **All chats** | Every conversation in this workspace, summed. |
| **Total cost** | Money across **all chats** in this workspace (never resets). |

The word "session" is intentionally **not** used in the UI because it was ambiguous.

---

## 2. Product surfaces

Open with **Token Lens: Open dashboard** (or the activity-bar icon). Five tabs: **Live**, **Overview**, **Turns**, **Profiles**, and **Info**. Live is the default pitch and daily-work surface.

### Overview
- Persistent personal totals for Today / 7 days / 30 days / All.
- Applications, models, and projects ranked by known metered tokens.
- Native Copilot AICs and configured token-rate or AIC-rate dollars with explicit known-cost labels when the basis is incomplete.
- Data coverage, source health/capabilities, recent metadata-only activity, ledger record count, local size, and retention.
- Recent Activity is the durable cross-chat timeline and is collapsed by default
	to keep Overview focused on aggregate accounting.
- **Export all** saves every retained metadata-only record as versioned JSON or
	flat CSV; the user chooses the destination and nothing uploads automatically.

### Live
The existing real-time Copilot experience remains transient and source-specific:

### Chat header
Shows the active chat's title (or `Chat <id>`) and the current turn number.

### Next (forecast) card
- **Last turn → Next turn (est.)** — the real input tokens the previous turn cost vs. the predicted cost of your next prompt, side by side.
- A one-line detail: `≈ N credits · range low–high tokens` (adds `low conf.` when uncertain).
- **Forecast accuracy** — median error of past predictions on your own turns (self-measured at runtime).
- An experimental warning when context enters a possible reset zone; current
  validation does not support treating it as reliable reset prediction.

### Context weight card
- Tokens currently carried, as a bar that fills and reddens toward the model's context limit (e.g. `12% of the 1.0M-token limit`).
- A band label: Light → Moderate → Heavy → Critical → Overloaded.
- A per-turn **bar graph** of context growth (downsampled for long chats) with a full-resolution trend line; resets show as drops. X-axis marks turn 1, reset count, and now.

### Where tokens go card
Input tokens split by category (**system / tools / history / message**) as stacked bars for **This prompt → This chat → All chats · N**, sharing one color legend. Data comes straight from Copilot's on-disk `promptTokenDetails`.

### Total cost card
Three figures — **Tokens**, **AICs** (Copilot credits), and **Cost** — selectable for the workspace, this chat, or today. Each shows the last metered turn's matching-unit delta (`▲`). Dollars are a derived estimate (see config below); AIC totals are marked estimated if any turn lacks a metered credit value.

### Live Copilot data card
The active model/agent and its reasoning effort (shown only when known).

### Profiles tab
- Optional built-in or custom attribution profiles; core ledger capture remains independent.
- **FD&E HQ vs other** request attribution with four mutually exclusive evidence buckets: explicit workflow (high), tool-associated (medium), mixed (low), and Other Copilot.
- Whole-request tokens/cost, share of known spend, turns, and MCP calls per bucket. This is workflow attribution, not an exact per-MCP token split.
- Service call counts, success/failure, observed duration, configured external allocation, and associated cost by workflow.
- Every request appears once; workspace location alone never establishes FD&E attribution.

### Turns tab
A transient, newest-first list for the active Copilot chat. Prompt excerpts are never written to the durable ledger or export.

### Info tab
A compact in-product manual: quick start, tab guide, number definitions, card guide, controls/commands, feature priority, privacy, and known limits. The complete manual is in [USER-MANUAL.md](USER-MANUAL.md).

---

## 3. Forecasting engine (precognition)

- **Model-agnostic** and free (pure arithmetic) — works for any Copilot model.
- Rebuilds live from the active chat's **real metered tokens** on disk, so it appears immediately and doesn't depend on lagging capture.
- **Self-calibrating** prediction interval — tightens/loosens from the session's own actual-vs-predicted spread.
- **Reset-zone indicator** — an experimental model-relative proximity hint. The
	current expanded corpus shows poor recall and precision, so it is not a
	reliable prediction of the next summarization.
- **Tool-aware growth** — blends median turn growth with tool-call counts.
- **Runtime accuracy** — measures its own past predictions and reports the median error.

---

## 4. Sources, persistence, and privacy

- Source adapter v1 reads VS Code's per-workspace Copilot storage: transcript `.jsonl` files and `chatSessions` (for real metered tokens and credits).
- Content-free observations persist as append-only monthly JSONL partitions under VS Code global extension storage.
- Stable source identities plus canonical observation fingerprints suppress duplicate rescans and merge pending/partial/full revisions.
- Scoped to this window's workspace hash by default. `capture.scope=all` deliberately aggregates all windows; empty windows have the limitations documented in `KNOWN-ISSUES.md`.
- **Read-only.** No prompt, response, code/document content, tool argument, raw path, raw session ID, user ID, or machine ID enters the ledger. There is no telemetry or network upload.

---

## 5. Commands (Command Palette → "Token Lens")

| Command | What it does |
|---|---|
| **Open dashboard** | Reveal/focus the dashboard view. |
| **Toggle passive capture** | Start/stop reading Copilot sessions on disk. |
| **Pin to this chat** | Lock tracking onto the current chat so Token Lens keeps showing it even if a newer chat appears (useful when two windows share a folder). |
| **Unpin chat** | Clear the pin and follow the newest chat again. |
| **Show capture diagnostics** | Print scope, active-chat, and watcher details to Output → Token Lens. |
| **Capture self-test** | Verify that the active chat can be parsed and report how many turns are metered. |
| **Export local usage ledger** | The Overview **Export all** action and Command Palette entry explicitly save every retained record as metadata-only, versioned JSON or flat CSV. |
| **Clear local usage ledger** | Confirm and clear Token Lens metadata only; Copilot source files remain untouched. A local watermark prevents old source history from immediately returning. |
| **Rebuild local usage ledger** | Confirm, remove the clear watermark, and rescan all currently available local Copilot workspaces. |
| **Show local ledger diagnostics** | Print storage root, records, observations, bytes, duplicates, malformed partitions, conflicts, retention, and source capabilities. |

---

## 6. Key settings (`tokenlens.*`)

| Setting | Default | Purpose |
|---|---|---|
| `impact.usdPerMillionTokens` | `0.58` | **Preferred cost basis** — blended, cache-inclusive $/1M tokens. Set to your real effective rate for an accurate figure. `0` falls back to the credit rate. |
| `impact.usdPerCredit` | `0` | $/AIC, used only when the token rate is `0`. |
| `capture.scope` | `window` | `window` keeps each window isolated; `all` follows the newest Copilot chat in any window. |
| `passiveCapture.enabled` | `true` | Read Copilot sessions automatically (read-only). When off, only explicit diagnostics/self-test commands read on demand. |
| `businessTools.enabled` | `false` | Enable optional workflow/tool attribution independently from core token capture. |
| `businessTools.enabledGroups` | `[]` | Select built-in groups such as `fde-hq` or `all-mcp`, plus custom groups. |
| `businessTools.customGroups` | `{}` | Define future service/workflow match groups without changing extension code. |
| `businessTools.rates` | `{}` | Optional external allocation rates; missing rates remain unpriced. |

---

## 7. Removed / deprecated

Token Lens began as a prompt-efficiency **scoring + tamagotchi** tool, then pivoted to
pure cost visibility + forecasting. As of the v0.5.0 cleanup, the legacy subsystems are
**fully removed** from the codebase: the prompt scoring service, the rewriter, the
training corpus, the live LLM/heuristic coach, telemetry, the pet health/world model, and
~11 unused webview components. A rewrite helper remains only for reproducible historical
benchmarks. The
state contract (`TamaState`) now carries `{ personalLedger, metrics, model, captureEnabled, businessTools, forecast }`.
Overview is driven by the persistent local ledger; Live remains driven by the current source-specific forecast.
