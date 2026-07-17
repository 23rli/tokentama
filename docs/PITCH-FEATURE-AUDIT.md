# Token Lens pitch feature audit

_Prepared July 16, 2026 for tomorrow's pitch._

## Executive cut

Token Lens has two pitch-worthy claims:

1. **Live Copilot visibility:** measured last turn, next-turn forecast, context
   weight, where tokens go, current model, and cost.
2. **Private personal ledger:** durable local usage by time, application,
   provider/model, project, and data coverage.

Everything else supports those claims or belongs in Q&A.

## Core demo

| Feature | Why it stays | Pitch action |
| --- | --- | --- |
| Live next-turn forecast | Differentiated, local, self-measured accuracy | Show first |
| Context weight and growth graph | Explains structural cost and reset risk visually | Show |
| Where tokens go | Real Copilot category data; explains system/tools/history/messages | Show |
| Tokens / Copilot AICs / configured dollars | The usage and cost envelope | Show |
| Current model/reasoning | Identifies what is actually running when available | Point out if populated |
| Personal Overview | Durable local source of truth across time/projects/models | Show second |
| Data coverage | Prevents estimated or partial data being mistaken for measured facts | Mention briefly |
| Source health/capabilities | Shows adapter freshness and honest gaps | Show one line |
| Turns | Per-turn proof for active chat | Show briefly |
| Capture on/off | Visible privacy boundary | Show |
| Status bar | Ambient context load | Point out |

## Useful secondary

| Feature | Use |
| --- | --- |
| Forecast accuracy/range | Credibility; no false precision |
| Reset-zone indicator | Experimental proximity hint; do not present as validated reset prediction |
| Pin/unpin | Same-folder or multi-window ambiguity |
| Configurable token/AIC rate | Makes local dollar projection meaningful |
| Metadata-only export | Personal portability; secondary selling point |

## Advanced / Q&A

| Feature | Why not in main pitch |
| --- | --- |
| Profiles | Optional attribution; needs configured groups and evidence |
| FD&E HQ vs Other | Useful profile example, not product identity |
| External allocation rates | User assumptions, not provider billing |
| Custom groups | JSON expert configuration; no dedicated editor |
| Clear/rebuild | Lifecycle/support, not daily use |
| Capture/ledger diagnostics | Support tools |
| Self-test | QA/setup confirmation |

## Deferred

- Second AI application adapter.
- Cloud sync or multi-device merge.
- Team/leadership dashboard.
- Exact per-MCP token allocation.
- Agency CLI and Scout metering.
- Invoice reconciliation and automated chargeback.

## Fluff to hide, not delete before pitch

- Do not click Profiles unless asked.
- Do not demonstrate export, clear, rebuild, diagnostics, or custom JSON.
- Do not wait for a reset-risk warning to occur.
- Do not explain context graph downsampling or pending-state internals.
- Do not lead with source coverage gaps; explain the explicit input-only,
  output-only, or unavailable label only if it appears.
- Do not dwell on the live status-dot animation or tooltip implementation.

## Dead or inert cleanup after pitch

These files remain from the retired prompt-scoring/pet/coaching product and are
not part of the 0.8.3 runtime pitch:

- `src/types/PetWorldState.ts`
- `src/types/Score.ts`
- `src/types/Tip.ts`
- `src/types/SessionSummary.ts`
- `src/types/Telemetry.ts`
- `src/capture/parsers/sessionTracker.ts`
- most of `src/coaching/heuristicCoach.ts`
- old pet/scoring/coaching CSS blocks in `webview-ui/src/styles.css`

They should be removed in a dedicated post-pitch cleanup with import/test review.
They do not need to block tomorrow because esbuild tree-shakes unreachable code
from the packaged runtime.

## Pitch order

1. **Live:** measured last turn → next forecast.
2. **Live:** context weight and where tokens go.
3. **Live:** total tokens/AICs/dollars and model.
4. **Overview:** Today/30 days and model/project drivers.
5. **Overview:** source health and local-only metadata ledger.
6. **Turns:** brief per-turn proof.
7. End on privacy: local, content-free persistence, capture switch.

## Pre-pitch checklist

- Reload VS Code after installing the final VSIX.
- Use one folder/workspace window.
- Capture on, scope `window`.
- Use a real chat with at least five fully metered turns.
- Run **Capture self-test** before the meeting.
- Run **Rebuild local usage ledger from all Copilot history** beforehand, not live.
- Keep Profiles off unless demonstrating them intentionally.
- Configure a defensible effective token rate or describe dollars as illustrative.
- Capture screenshots as fallback.
- Never present `.preview.html` fixture values as measured usage.
