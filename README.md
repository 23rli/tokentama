# Tokentama — real-time cost visibility for GitHub Copilot

**Tokentama is a VS Code sidebar that shows what your GitHub Copilot session actually costs — live, per turn, and before you send the next prompt.** It reads the real metered token and credit numbers Copilot records on disk, shows where those tokens go, forecasts the next turn's cost, and warns when a chat has grown too heavy to sustain.

It makes no savings claims. Agentic AI coding costs tokens the way a factory costs electricity; the cost is **structural** (re-sent context, tool definitions, model tier), not something you meaningfully lower by "prompting better." What has been missing is not another optimizer — it's a **meter**. Tokentama is that meter.

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
| **Session cost** | Running totals in tokens and Copilot credits (AICs); dollars when an AIC→$ rate is configured. |
| **Live Copilot data** | The model, reasoning effort, and context window actually in use, read live from the session. |

## How it works

- **Local and read-only.** Tokentama reads Copilot's on-disk session logs (`transcripts`, `chatSessions`, `models.json`) under your VS Code storage. Nothing is uploaded; no API key; no model calls.
- **Real metered numbers.** Token and credit counts come from what Copilot actually recorded, not estimates — estimates are used only as a clearly-labelled fallback.
- **Model-agnostic forecaster.** The next-turn estimate is pure local arithmetic that **self-calibrates to each session** — its prediction interval is derived from your own accuracy spread, and reset detection uses the model's real context limit. It adapts to Claude, GPT, Auto, or a small-window model with no per-model tuning, and it costs **zero tokens**.
- **Honest by construction.** Steady turns predict to ~3% median error; genuinely unpredictable turns (summarization resets, large tool bursts) are flagged rather than guessed. The interval is the headline, not a false-confident point.

## What it does *not* do

- It does **not** claim to save you tokens. Extensive measurement on real sessions showed prompt rewriting, right-sizing, and prompt phrasing move the bill by ~0–modest amounts that don't survive real usage. See [`docs/app-journey-and-direction.md`](docs/app-journey-and-direction.md) and [`docs/tokentama-decision-brief.md`](docs/tokentama-decision-brief.md) for the full evidence trail.
- It does **not** change your prompts, model, or context. It observes and forecasts.

## Privacy

100% local and read-only. Tokentama never sends your prompts, code, or usage anywhere. All analysis runs on your machine against files Copilot already wrote to disk.

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
node esbuild.mjs          # build extension + webview
npm test                 # unit tests
```

Press **F5** to launch the Extension Host; the dashboard appears in the Tokentama sidebar and populates from your active Copilot session within a few seconds.

## Status

Early, single-developer validation. The forecaster and visibility are working and test-covered; org-scale cost attribution and multi-user accuracy validation are the next milestones.
