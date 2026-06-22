# EcoPrompt Guardians — Team Handoff & Status

> **What this is:** a single update for the team on what exists today, how it was
> built, how to run it, and how to extend it. Companion docs:
> [ARCHITECTURE.md](ARCHITECTURE.md) (how it all connects) and
> [CLOUD_MVP_PLAN.md](CLOUD_MVP_PLAN.md) (taking it to the cloud).

---

## 1. TL;DR

EcoPrompt Guardians is a **working end-to-end prototype**. A prompt is ingested,
scored for "waste," coached with a tip + rewrite, and visualized as a Tamagotchi-style
ecosystem in an Electron desktop widget that thrives or decays with prompt quality.

- **Runs today** on a laptop with one command (`npm run widget:dev`) — including a
  scripted demo that shows the full `thriving → collapse → recovery` arc.
- **Backend is cloud-ready in code** (Azure Functions + Bicep + Table Storage + App
  Insights + LLM adapter) but is **not deployed yet** — it currently runs as a local
  Node server with an in-memory store.
- **44 automated tests pass**; lint, build, typecheck, and formatting are all green.

---

## 2. How we got here (development history)

Three commits tell the story (from `git log`):

| Commit                         | What landed                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `96417f0` **project plan**     | The strategy/architecture groundwork.                                                                                    |
| `37d88aa` **full first draft** | The entire system — ~116 files: all 6 packages/apps, 44 tests, Bicep infra, CI, and docs. This is the bulk of the build. |
| `033b33c` **panel fixes**      | Bug fixes to make the widget actually usable (see §6).                                                                   |

The `37d88aa` commit established the full monorepo: `shared-types`, `scoring-engine`
(with 6 waste detectors + pet-state machine), `ingestion` (scripted/manual/live
adapters + Copilot file parsers), `llm-adapters` (heuristic + LLM coach), `apps/api`
(dual local/Azure), and `apps/desktop-widget` (Electron + React + procedural Canvas
world). Line endings were normalized to LF via `.gitattributes` in the same period.

---

## 3. What works right now

- ✅ **Scoring engine** — deterministic waste + efficiency scoring across 6 categories,
  5 subscores, pet-state mapping, token + cost estimation. Fully unit-tested.
- ✅ **Coaching** — heuristic tips + prompt rewrites + savings estimates out of the
  box; LLM coaching ready behind env config.
- ✅ **Three ingestion modes** — scripted demo, manual entry, and live local Copilot
  chat tail-reading.
- ✅ **Desktop widget** — frameless always-on-top companion, three window modes,
  system tray, procedural world that reacts to score, score gauge, tip bubble,
  subscore breakdown, history, and a metrics tab.
- ✅ **API** — `health`, `scorePrompt`, `generateTip`, `sessionSummary`, with an
  offline fallback so the widget works even when the API is down.
- ✅ **Cloud scaffolding** — Bicep for the full Azure footprint; deploy guide in
  [azure-deploy.md](azure-deploy.md).

---

## 4. Run it in 2 minutes

```powershell
npm install
npm run build
npm run widget:dev      # launches the Electron widget (scripted demo mode by default)
```

Optional — run the API too (the widget auto-detects it; otherwise it scores locally):

```powershell
npm run api:start       # local Node server on http://localhost:7071/api
```

Headless demo (prints the score arc to the console, great for a quick sanity check):

```powershell
npm run demo
```

> **Windows note:** if `npm` isn't found, Node is at `C:\Program Files\nodejs`; add it
> to PATH. If PowerShell blocks `npm.ps1`, run
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once. `electron-vite dev` does
> not auto-restart on **main-process** edits — relaunch to pick those up.

---

## 5. Execution plan → code: where each epic stands

Mapping the [execution plan](../EcoPrompt_Guardians_Master_Design_Doc.md) epics to what's in the repo:

| Epic                                   | Status         | Where it lives / what's left                                                                                                                                                                                             |
| -------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1. Desktop Widget** (SWE #1)         | 🟢 Mostly done | `apps/desktop-widget`. Shell, dock/minimize (3 window modes), tray, world rendering, wired to scoring all done. **Left:** richer notifications; design doc's **PixiJS** is currently plain Canvas (`WorldRenderer.tsx`). |
| **2. Scoring Engine** (SWE #2)         | 🟢 Done        | `packages/scoring-engine`. Efficiency + waste formulas, long/repeat/retry/tool detectors, score API, score history. Unit-tested.                                                                                         |
| **3. AI Coach** (SWE #3)               | 🟢 Done        | `packages/llm-adapters`. Tips, "better version" rewrite, token/latency savings, message library (heuristic), LLM path ready.                                                                                             |
| **4. Backend & Analytics** (SWE #4)    | 🟡 Partial     | `apps/api` + `infra/bicep` exist (Azure backend, telemetry, token/score tracking). **Left:** deploy to Azure; **Power BI dashboard, leaderboard, achievements not built.**                                               |
| **5. Business Case** (Finance — Ethan) | ⚪ Not in code | The numbers it needs are emitted: `estimatedTokensSaved`, `estimatedCostSavedUsd`, waste-by-category (`SessionSummary` / metrics tab). Build the ROI model on top of these.                                              |
| **6. Pitch & Storytelling** (TPM)      | 🟡 Partial     | `docs/demo-script.md` + the scripted demo arc are ready. **Left:** deck, video, Q&A.                                                                                                                                     |

Legend: 🟢 done · 🟡 partial · ⚪ not started in code

---

## 6. Two bugs fixed in `panel fixes` (so they don't bite again)

Both were in the widget and are documented here because they're easy to reintroduce:

1. **Invisible window.** A `transparent: true` + frameless Electron window renders as a
   completely invisible (unpainted) window on many Windows GPU setups. Fixed by using
   `transparent: false` + `backgroundColor: '#0f1722'` in
   `apps/desktop-widget/src/main/index.ts`. The window was also moved to the
   **top-right** and now uses `showInactive()` so it never steals focus while you type.
2. **Blank panel / infinite render loop.** Under **Zustand v5**, a selector that
   returns a _new object_ (`useStore(s => ({...}))`) fails `Object.is` equality every
   render → "Maximum update depth exceeded" → React unmounts → you see only the
   background color. Fixed in `App.tsx` by selecting **individual fields**. Use
   `useShallow` if you ever need to select multiple fields at once.

---

## 7. How to read the codebase (suggested order)

1. `packages/shared-types/src/*` — the contracts. Everything else references these.
2. `packages/scoring-engine/src/scorePrompt.ts` — the heart; follow it into
   `heuristics/` and `calculators/`.
3. `packages/llm-adapters/src/coach.ts` — how coaching + fallback works.
4. `apps/api/src/core/handlers.ts` — what the API actually does per endpoint.
5. `apps/desktop-widget/src/main/services/ingestionBridge.ts` — the orchestrator that
   ties ingestion → scoring → coaching → UI.
6. `apps/desktop-widget/src/renderer/src/App.tsx` + `WorldRenderer.tsx` — the UI.

[ARCHITECTURE.md](ARCHITECTURE.md) has the diagrams and a per-file map.

---

## 8. Building further

- **To take it to the cloud / make it a true non-local MVP:** follow
  [CLOUD_MVP_PLAN.md](CLOUD_MVP_PLAN.md). Shortest path (P0–P2): deploy the existing
  Functions + Bicep, flip storage/telemetry/LLM via env, then host the React renderer
  as a Static Web App with scripted + manual modes.
- **To extend scoring:** add a `Detector` in `packages/scoring-engine/src/heuristics/`
  and register it in `heuristics/index.ts` — weights live in `calculators/wasteScore.ts`.
- **To improve coaching:** edit `promptTemplates.ts` (LLM) or the per-category
  `SHORT_TIPS` in `heuristicCoach.ts`.
- **To add analytics (Epic 4):** the telemetry events and `sessionSummary` aggregation
  already exist — build Power BI / a dashboard on top, then add leaderboard + achievements.
- **Keep it green:** run `npm run lint && npm run build && npm test && npm run format:check`
  before pushing. CI (`.github/workflows/ci.yml`) runs on push.

---

## 9. Open decisions for the team

- **PixiJS vs. Canvas** for the world art (design doc says PixiJS; we shipped Canvas).
- **Table Storage vs. Cosmos DB** — depends on leaderboard/query needs (Epic 4).
- **Web app vs. Electron** as the primary surface for the cloud MVP (see Cloud Plan §3).
- **Live ingestion approach** — paste-only vs. browser/VS Code extension vs. APIM
  gateway (Cloud Plan §4).
