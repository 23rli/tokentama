# 🐣 Tokentama

> A friendly VS Code sidebar buddy that shows you — in plain dollars, carbon, and water — what your AI prompts actually cost, and helps you write leaner ones. Prompt well and your little pet's world thrives; waste tokens and it wilts.

---

## 🌟 In one minute

Every time you chat with an AI coding assistant (like GitHub Copilot), your words are turned into **tokens**, and tokens aren't free — they cost **money**, burn **energy** (carbon), and even use **water** to cool the data centres.

Most of that cost is invisible. **Tokentama makes it visible.** It lives in your VS Code sidebar as a tiny **Clippy-style pet in a little world**:

- 🟢 Write **clear, lean prompts** → the sun shines, the lake fills, and Clippy sprints around happily.
- 🔴 **Waste tokens** (repeat yourself, ramble, stay vague) → the lake dries up, the sky greys over, and Clippy slows down… and eventually keels over.

Alongside the pet, you get a **TokenScore** for each prompt, the **real cost** in 💵 / 🔥 / 💧, a tiny **coach** that rewrites weak prompts for you, and a peek at the **live data** we read from your Copilot session.

> 💡 **Want to see it instantly?** Open the Tokentama sidebar and click **▶ Demo** — it plays a short story that walks Clippy from a thriving world all the way down to a dormant one and back.

---

## 🧭 What you see (a tour of the dashboard)

The dashboard is a single, no-scroll panel. Here's each piece — what it means for *you*, and (for the curious) exactly how it works.

### 🪴 Your pet & its world

Meet your pet: a little Clippy who lives in a tiny ecosystem. The **scene reacts to your prompting habits** — clean prompts keep the world green and the lake full; wasteful ones cause a drought. It's a pet that's only as healthy as the way you talk to your AI.

<details>
<summary><b>Under the hood — the six world states</b></summary>

Your pet's world has six states, driven by a smoothed health value (an exponential moving average of your recent scores, so one bad prompt won't instantly tank it):

| Score band | World state | Vibe |
| --- | --- | --- |
| 80–100 | **Thriving** | Bright sky, full lake, Clippy sprinting |
| 60–79 | **Healthy** | Green and steady |
| 40–59 | **Concerned** | Lake shrinking, colours fading |
| 20–39 | **Critical** | Brown, sun sinking |
| 1–19 | **Collapse** | Clippy has fallen over |
| 0 | **Dormant** | A dark, dystopian, waterless world |

The whole landscape is driven by a single `--fill` value (0–1) derived from the score: the lake recedes to reveal a cracked riverbed, greenery withers, the sun reddens and sinks, and the sky bands shift — a drought you cause, not just a progress bar. The art is rendered as **pixel-art** (banded skies, a blocky sun, a pixel mesh) using sprite art from the open-source [vscode-pets](https://github.com/tonybaloney/vscode-pets) project.
</details>

### 🔢 The TokenScore

A single **0–100 score for how efficient your prompt was.** Higher is leaner. It's based on the four habits that waste the most tokens:

- **Duplicate** — repeating context you already gave, or re-sending the same request.
- **Vague** — no clear task, target, or output format (which forces clarifying back-and-forth).
- **Verbose** — padding, politeness filler, and "give me everything" asks.
- **Ignored coaching** — you were given a tip last time and didn't take it.

<details>
<summary><b>Under the hood — the scoring formula</b></summary>

`overallScore = 100 − wasteScore`, where `wasteScore` is a weighted sum of independent detectors (each producing a 0–1 severity), clamped to 0–100:

| Factor | Detector(s) | Weight |
| --- | --- | --- |
| Duplicate | `redundantContext` (0.30) + `retryLoop` (0.25) | **0.55** |
| Vague | `vagueness` | 0.20 |
| Verbose | `verbosityMismatch` | 0.15 |
| Ignored coaching | `ignoredCoaching` | 0.10 |
| _(Tool overuse)_ | `toolOveruse` | 0 — excluded from the headline score |

Design choices that make the score **stable and trustworthy**:
- **Deterministic & prompt-intrinsic.** The same prompt always scores the same. Verbosity is detected from the prompt's *own* padding (not the AI's response length, which varies run to run).
- **No threshold cliffs.** Penalties ramp smoothly, so two near-identical prompts get near-identical scores.
- **Transparent.** Each factor names *what* triggered it (e.g. "Underspecified: no output format, no task verb"), shown right under the quality bars.

Five internal sub-dimensions (`promptQuality`, `contextEfficiency`, `toolEfficiency`, `outputEfficiency`, `learningAdoption`) are still computed and available in the data model for deeper analysis.
</details>

### 💵 🔥 💧 Real-world impact

Three tiles show what your session has actually cost — in **dollars, grams of CO₂, and millilitres of water** — with the share that was **wasted** (caused by inefficiency) called out beneath each. A caption translates the total into something relatable, like *"≈ an afternoon of chat with my repo."*

<details>
<summary><b>Under the hood — the conversion factors & sources</b></summary>

Footprint is computed from token counts using a simple linear model:

- **CO₂:** `0.11 g` per 1,000 tokens (≈ 110 g per 1M)
- **Water:** `2 mL` per 1,000 tokens (≈ 2 L per 1M)
- **Dollars:** the **real per-model price** Copilot ships in its `models.json` (not a generic estimate)
- **Wasted portion:** `Σ (tokens × wasteScore%)` per prompt → converted to footprint, so the "wasted" figure is tied directly to your TokenScore.

Both environmental factors are configurable (`tokentama.impact.*`). The defaults follow published per-token estimates (Antarctica.io One-Token Model · UC Riverside · Lawrence Berkeley National Lab · *"How Hungry is AI?"*, arXiv 2025).
</details>

### 📊 Live Copilot data

Proof that this isn't guesswork — a compact strip shows the **actual data we read from your Copilot session**: which **AI model/agent** you're using and its **reasoning level**, the **tokens this prompt** used, and your **running session totals**. A badge tells you whether those token counts are **real** (metered, read from disk) or **estimated**.

<details>
<summary><b>Under the hood — where this comes from</b></summary>

- **Agent / reasoning / context window** come from Copilot's model catalog (`models.json`): the model name, picker category (e.g. *powerful*), supported reasoning efforts (e.g. *low–max*), and max context window.
- **This prompt** shows input/output tokens and **Copilot credits** when they've been metered to disk in the chat session's patch log.
- **Session** sums tokens, credits, and cost across everything scored this session.
- The **real / estimated** badge reflects whether counts were read from Copilot's on-disk session data or estimated with a tokenizer.
</details>

### 🧑‍🏫 Coaching

When a prompt is weak, you get a **one-line tip** and a **cleaned-up rewrite** you can copy straight into Copilot. The rewrite strips filler, removes duplication, and adds the missing structure (a clear target, an output format, a size limit).

<details>
<summary><b>Under the hood — offline by default, LLM optional</b></summary>

- **Heuristic coach (default, offline, no network):** deterministically rewrites the prompt — de-duplicates sentences, strips politeness/retry filler, then appends only the lines that address the detected problems (Target / Output / Limit / Context / Since-last-try).
- **LLM coach (optional):** if you configure a provider and key (see settings), tips and rewrites come from your chosen model, falling back to the heuristic coach on any error so coaching never breaks.
</details>

---

## 🎬 The Demo button

Click **▶ Demo** to watch a scripted story play out: seven prompts, from a pristine one-liner down to a catastrophic re-paste-and-retry mess, then a clean recovery — so you can see Clippy move through **every** world state in about ten seconds.

<details>
<summary><b>Under the hood</b></summary>

Each demo step is **really scored** (so the quality bars, reasons, coaching, and impact are genuine), while the headline score is scripted and the pet's health is forced to that value — guaranteeing every state is shown clearly regardless of smoothing.
</details>

---

## 🎣 How it reads your prompts

There are **three ways** to get a prompt scored — pick whatever fits your flow:

1. **Type `@tokentama`** in Copilot Chat followed by your prompt — instant, explicit scoring.
2. **Click "Score a prompt"** (or run the command) and paste/select any text.
3. **Let it watch passively** — it quietly reads your Copilot chat sessions and scores them as you go (read-only; it never changes anything).

<details>
<summary><b>Under the hood — capture details & privacy</b></summary>

- **Chat participant:** `@tokentama` is a registered VS Code chat participant.
- **Manual:** the **Score this prompt** command scores editor text or pasted input.
- **Passive watcher:** reads VS Code's Copilot chat transcripts on disk (`…/workspaceStorage/<hash>/GitHub.copilot-chat/…`). It is **read-only**, scoped to the current window's workspace, and best-effort (the on-disk format is undocumented). Use **Scan recent Copilot prompts** to score the last few on demand, and **Show capture diagnostics** to see exactly what it's reading.

Everything stays **on your machine**. Nothing is sent anywhere unless you explicitly turn on an LLM coaching provider.
</details>

---

## 🚀 Install & try it

> Not yet on the Marketplace — run it from source or build a local package.

```powershell
npm install
npm run build     # bundles the host + webview with esbuild
# Press F5 in VS Code to launch the Extension Development Host
```

Then open the **Tokentama** view from the Activity Bar and click **▶ Demo**, or run **Tokentama: Score this prompt** and paste a long, rambling prompt to watch the pet react.

To install into your everyday VS Code, build a package and install the `.vsix`:

```powershell
npm run vsce:package          # produces tokentama-<version>.vsix
# then: Extensions view → "…" menu → Install from VSIX…
```

### Commands

Open the Command Palette (`Ctrl/Cmd+Shift+P`) and search **Tokentama**:

| Command | What it does |
| --- | --- |
| **Score this prompt** | Score pasted/selected text on demand |
| **Open Tokentama dashboard** | Reveal the sidebar dashboard |
| **Run Tokentama demo** | Play the all-states demo (also the ▶ Demo button) |
| **Scan recent Copilot prompts** | Score your last few real Copilot prompts now |
| **Toggle passive capture** | Turn automatic Copilot watching on/off |
| **Reset ecosystem** | Start the pet's world fresh |
| **Show capture diagnostics** | See what the passive watcher is reading |
| **Set coaching LLM API key** | Store an LLM key securely (SecretStorage) |

### Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `tokentama.passiveCapture.enabled` | `true` | Passively read Copilot chat sessions (read-only, experimental) |
| `tokentama.coaching.llmProvider` | `none` | `none` = offline heuristic coach; `openai` / `azure-openai` = use an LLM |
| `tokentama.coaching.endpoint` | `""` | LLM endpoint URL |
| `tokentama.coaching.model` | `gpt-4o-mini` | Model / deployment name |
| `tokentama.impact.co2GramsPer1kTokens` | `0.11` | Grams of CO₂ per 1,000 tokens (headline impact) |
| `tokentama.impact.waterMlPer1kTokens` | `2` | Millilitres of water per 1,000 tokens (headline impact) |
| `tokentama.sustainability.whPerThousandTokens` | `0.4` | Watt-hours per 1,000 tokens (energy-saved estimate) |
| `tokentama.sustainability.gridGramsCo2PerKwh` | `400` | Grid carbon intensity (gCO₂e/kWh) |

### 🔒 Privacy in one line

Your prompts, scores, and history are stored **locally** in extension storage; passive capture is **read-only**; **nothing leaves your machine** unless you configure an LLM coaching provider.

---

## 🛠️ Under the hood (for contributors)

<details>
<summary><b>Project layout</b></summary>

```
src/                         # extension host (Node)
├─ extension.ts              # activation: view, status bar, commands, watcher, @tokentama
├─ capture/                  # Copilot session reader + file watcher + parsers
├─ core/scoreService.ts      # score → coach → persist pipeline (+ the demo runner)
├─ scoring/                  # waste detectors, subscores, pet-state machine, token/cost model
├─ coaching/                 # heuristic + optional LLM coach
├─ metrics/                  # metrics.ts (session aggregation) + impact.ts (CO₂/water footprint)
├─ state/tamaStore.ts        # persisted pet state (globalState), smoothed health
├─ status/                   # status-bar indicator
├─ types/                    # shared domain contracts
└─ webview/                  # webview provider + HTML/CSP + host↔webview message contract

webview-ui/src/              # Preact dashboard
└─ components/               # PetStage, ScoreHeader, ImpactTrio, LiveData, QualityBars, CoachingPanel
```
</details>

<details>
<summary><b>Build, test & package scripts</b></summary>

| Script | Purpose |
| --- | --- |
| `npm run build` | Bundle the extension host + webview (esbuild) |
| `npm run watch` | Rebuild on change |
| `npm run typecheck` | `tsc --noEmit` across host + webview |
| `npm test` | Run the scoring / ingestion / coaching unit tests (Vitest) |
| `npm run vsce:package` | Produce an installable `.vsix` |

The scoring engine, coaching, and metrics are **pure TypeScript** with no VS Code dependency, so they're unit-tested directly.
</details>

## License

MIT — see [LICENSE](LICENSE). Pet sprite art is from the open-source [vscode-pets](https://github.com/tonybaloney/vscode-pets) project (MIT).
