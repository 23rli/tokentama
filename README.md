# Token Lens — your local personal AI usage ledger

**Token Lens is a private, durable source of truth for one developer's AI usage.** It keeps a content-free usage ledger on your machine, shows measured tokens, provider-native charges, configured cost, applications, models, projects, and data coverage, and retains the live GitHub Copilot forecast that started the project.

GitHub Copilot Chat is the first source adapter. The ledger contract is source-neutral so future local AI applications can be added without changing historical records or the core UI. There is no cloud service, account, automatic upload, or team dashboard.

---

## The problem

- **Personal AI usage is fragmented.** Applications expose different units, histories, models, and levels of metering completeness.
- **Live data disappears into source-specific logs.** There is no durable personal view across projects and time.
- **Copilot's cost is invisible while you work.** You get a monthly bill, never a live, per-session, "where did the tokens go" view.
- **Re-sent context dominates.** ~85%+ of a turn's cost is the conversation/context re-sent every turn — it grows silently until a session is expensive and, eventually, auto-summarized.
- **No forecast.** Nothing tells you what the *next* turn will cost, or that you're about to hit a context reset.

## What it shows

| Panel | What it answers |
| --- | --- |
| **Personal overview** | How much AI have I used today, this week, this month, and overall? Which applications, models, and projects drive it? How complete is the data? |
| **Source health** | Which local adapters are working, what do they measure, and which dimensions are unavailable? |
| **Next-turn forecast** | The predicted input tokens/credits for your next turn, with a calibrated range — and the last **real** turn beside it, clearly labelled, so predicted vs actual is never confused. |
| **Live accuracy** | The forecaster's own self-measured accuracy on *your* real turns (e.g. `acc 96/100`), so the number is earned, not asserted. |
| **Context weight** | How heavy the session has become vs. the model's real context limit, with a per-turn growth graph. Observed resets appear as drops; an experimental proximity signal can mark a possible reset zone. |
| **Where your tokens go** | The system / tool-definitions / history / message split of the current turn — the real cost driver, broken out. |
| **Total cost** | Selectable workspace / current-chat / today totals in tokens and Copilot credits (AICs), plus dollars when a rate is configured. |
| **Profiles** | Optional local labels correlate whole requests with selected workflows and toolsets. Profiles never rewrite immutable usage facts. |
| **Live Copilot data** | The model, reasoning effort, and context window actually in use, read live from the session. |

## How it works

- **Local and read-only.** The Copilot adapter reads on-disk session logs (`transcripts`, `chatSessions`, `models.json`). The normalized ledger lives in VS Code global extension storage. Nothing is uploaded; no API key; no model calls.
- **Content-free persistence.** Durable observations contain usage units, provenance, application/provider/model, a pseudonymous project key with local alias, content-free tool metadata, and evidence labels. They do not contain prompts, responses, code, documents, tool arguments, raw paths, or personal identifiers.
- **Revision-aware.** Unavailable, one-direction, in-flight, and fully metered revisions merge into one logical request. Rescans and multiple VS Code windows do not double count.
- **Real metered numbers.** Authoritative token totals include only the directions Copilot actually metered. Missing meters remain explicitly unavailable; local estimates are reserved for labelled forecast/projection surfaces.
- **Model-agnostic forecaster.** The next-turn estimate is pure local arithmetic that **self-calibrates to each chat** — its prediction interval is derived from observed accuracy spread, and the experimental reset-risk signal uses the model's real context limit. It adapts without per-model tuning and costs **zero tokens**.
- **Honest by construction.** Steady turns predict to ~3% median error in the current local corpus. Surges and summarization resets remain known failure modes; the interval and confidence are primary, and the reset-risk signal is not presented as a guarantee.
- **Opt-in MCP and skill attribution.** Selectable built-in or custom groups
  reduce standard MCP tool identifiers and completed `SKILL.md` loads to
  content-free local activity metadata. External
  service dollars appear only when you configure a marginal rate; unknown calls
  remain explicitly unpriced. See [business-tool cost attribution](docs/BUSINESS-TOOLS.md).

## What it does *not* do

- It does **not** claim to save you tokens. Measurement on real sessions showed
  prompt rewriting, right-sizing, and prompt phrasing produce little durable
  savings in normal use.
- It does **not** change your prompts, model, or context. It observes and forecasts.
- It does **not** sync across devices or provide a team/leadership dashboard.
- It does **not** claim exact tokens per MCP call when the source has no per-call meter.

## Privacy

100% local and read-only. Token Lens never sends prompts, code, or usage anywhere. Turning **Capture off** stops source reads while the already-persisted metadata ledger remains available. Records are retained until clearing the ledger is explicitly confirmed from **Token Lens: Manage data and diagnostics…**.

Profiles are off by default and can be changed without rewriting ledger facts.
Export is manual, metadata-only, and deliberately secondary. Select **Export all**
in Overview (or run **Token Lens: Export usage ledger**), choose JSON or
CSV, and select a local destination. All retained records are exported; nothing
is uploaded automatically.

## Test-drive the extension

1. Install the packaged VSIX, then run **Developer: Reload Window**.
2. Open a folder in VS Code (recommended for per-window isolation).
3. Send a prompt in GitHub Copilot Chat.
4. Open Token Lens. Live is first; Overview holds the durable personal history.

See [the user manual](docs/USER-MANUAL.md) for every tab, number label,
control, privacy boundary, limitation, and the pitch-ready demo path.

See [the complete product journey, feature map, and direction](docs/app-journey-and-direction.md)
for every path explored, the evidence and verdict, the current architecture and
feature inventory, what has been achieved, and the application's future potential.

For a concise leadership or pilot pitch, use the
[Token Lens sales one-pager](docs/TOKEN-LENS-ONE-PAGER.md).

Version 0.8.4 ships one adapter: VS Code GitHub Copilot Chat. Other AI applications are future adapters, not implicit claims of current support.

## Troubleshooting

If no data appears:

- Confirm the dashboard footer says **Capture on**.
- Send at least one Copilot Chat prompt in the same VS Code window.
- Open **Token Lens: Manage data and diagnostics…**, then run **Test current
  chat capture** and **Check capture health**. Inspect **Output → Token Lens**.
- After installing a new VSIX, run **Developer: Reload Window**.

Two VS Code windows opened on the same folder share Copilot's on-disk workspace storage. Run **Token Lens: Pin or unpin current chat** if both windows are active. See [`docs/KNOWN-ISSUES.md`](docs/KNOWN-ISSUES.md) for remaining data-source limitations.

## Methodology & reproducible benchmarks

Every number in the docs is reproducible locally on your own data:

```
npm run bench:cache          # cache/pricing structure of the bill
npm run bench:forecast       # forecaster accuracy vs real metered tokens
npm run bench:forecast:lab   # error by turn type + interval calibration
npm run bench:forecast:robust# adaptivity across simulated models/tokenizers
```

## Develop

```
npm install
npm run typecheck         # TypeScript validation
npm test                  # unit tests
npm run build             # extension + webview
node scripts/smoke.mjs    # bundled activation smoke test
npm run bench:ledger      # 100k-observation local ledger benchmark
npm run vsce:package      # production VSIX
```

Press **F5** to launch the Extension Host; the dashboard appears in the Token Lens sidebar and populates from your active Copilot session within a few seconds.

## Status

Early user-testing build. The local ledger, Copilot adapter, live forecast, privacy projection, persistence, revision materialization, personal queries, and explicit export are test-covered. A second local application adapter is deliberately deferred until this personal-ledger slice is validated.
