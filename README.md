# Token Lens — real-time cost visibility for GitHub Copilot

**Token Lens is a VS Code sidebar that shows what your GitHub Copilot chat costs — live, per turn, and before you send the next prompt.** It reads the real metered token and credit numbers Copilot records on disk, shows where those tokens go, forecasts the next turn's cost, and warns when a chat is nearing a context reset.

It makes no savings claims. Agentic AI coding costs tokens the way a factory costs electricity; the cost is **structural** (re-sent context, tool definitions, model tier), not something you meaningfully lower by "prompting better." What has been missing is not another optimizer — it's a **meter**. Token Lens is that meter.

---

## The problem

- **Copilot's cost is invisible while you work.** You get a monthly bill, never a live, per-session, "where did the tokens go" view.
- **Re-sent context dominates.** ~85%+ of a turn's cost is the conversation/context re-sent every turn — it grows silently until a session is expensive and, eventually, auto-summarized.
- **No forecast.** Nothing tells you what the *next* turn will cost, or that you're about to hit a context reset.

## What it shows

| Panel | What it answers |
| --- | --- |
| **Next-turn forecast** | The predicted input tokens/credits for your next turn, with a calibrated range — and the last **real** turn beside it, clearly labelled, so predicted vs actual is never confused. |
| **Live accuracy** | The forecaster's own self-measured accuracy on *your* real turns (e.g. `acc 96/100`), so the number is earned, not asserted. |
| **Context weight** | How heavy the session has become vs. the model's real context limit, with a per-turn growth graph. Turns amber → red and flags when a summarization reset is imminent. |
| **Where your tokens go** | The system / tool-definitions / history / message split of the current turn — the real cost driver, broken out. |
| **Total cost** | Selectable workspace / current-chat / today totals in tokens and Copilot credits (AICs), plus dollars when a rate is configured. |
| **Live Copilot data** | The model, reasoning effort, and context window actually in use, read live from the session. |

## How it works

- **Local and read-only.** Token Lens reads Copilot's on-disk session logs (`transcripts`, `chatSessions`, `models.json`) under your VS Code storage. Nothing is uploaded; no API key; no model calls.
- **Real metered numbers.** Token and credit counts come from what Copilot actually recorded, not estimates — estimates are used only as a clearly-labelled fallback.
- **Model-agnostic forecaster.** The next-turn estimate is pure local arithmetic that **self-calibrates to each session** — its prediction interval is derived from your own accuracy spread, and reset detection uses the model's real context limit. It adapts to Claude, GPT, Auto, or a small-window model with no per-model tuning, and it costs **zero tokens**.
- **Honest by construction.** Steady turns predict to ~3% median error; genuinely unpredictable turns (summarization resets, large tool bursts) are flagged rather than guessed. The interval is the headline, not a false-confident point.

## What it does *not* do

- It does **not** claim to save you tokens. Measurement on real sessions showed
  prompt rewriting, right-sizing, and prompt phrasing produce little durable
  savings in normal use.
- It does **not** change your prompts, model, or context. It observes and forecasts.

## Privacy

100% local and read-only. Token Lens never sends your prompts, code, or usage anywhere. All analysis runs on your machine against files Copilot already wrote to disk. Turning **Capture off** stops the watcher and periodic disk reads; the explicit diagnostics and self-test commands still read on demand.

## Test-drive the extension

1. Install the packaged VSIX, then run **Developer: Reload Window**.
2. Open a folder in VS Code (recommended for per-window isolation).
3. Send a prompt in GitHub Copilot Chat.
4. Open the Token Lens activity-bar view. A just-sent turn appears as **pending** and fills with metered data after Copilot writes it to disk.

Token Lens supports VS Code's GitHub Copilot Chat only. It does not read Visual Studio, JetBrains, or other assistants.

## Troubleshooting

If no data appears:

- Confirm **Token Lens: Toggle passive capture** is on.
- Send at least one Copilot Chat prompt in the same VS Code window.
- Run **Token Lens: Capture self-test**.
- Run **Token Lens: Show capture diagnostics** and inspect **Output → Token Lens**.
- After installing a new VSIX, run **Developer: Reload Window**.

Two VS Code windows opened on the same folder share Copilot's on-disk workspace storage. Use **Token Lens: Pin to this chat** if both windows are active. See [`docs/KNOWN-ISSUES.md`](docs/KNOWN-ISSUES.md) for remaining data-source limitations.

## Methodology & reproducible benchmarks

Every number in the docs is reproducible locally on your own data:

```
npm run bench:history        # real sessions — cost breakdown in billed AICs
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
npm run vsce:package      # production VSIX
```

Press **F5** to launch the Extension Host; the dashboard appears in the Token Lens sidebar and populates from your active Copilot session within a few seconds.

## Status

Early user-testing build. The forecaster and visibility are working and test-covered; org-scale cost attribution and multi-user accuracy validation are the next milestones.
