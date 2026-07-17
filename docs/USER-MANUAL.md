# Token Lens user manual

_Last updated for Token Lens 0.8.3, July 16, 2026._

Token Lens combines two local views:

1. **Live Copilot visibility** for the current VS Code GitHub Copilot Chat.
2. **A durable personal usage ledger** containing content-free metadata retained
   on this machine until explicitly cleared.

GitHub Copilot Chat is the only source adapter in 0.8.3. Future AI applications
can implement the same ledger contract, but they are not currently measured.

## Quick start

1. Install the VSIX and run **Developer: Reload Window**.
2. Open a folder or workspace in VS Code.
3. Send a GitHub Copilot Chat request and let it finish.
4. Open Token Lens from the activity bar.
5. Use **Live** for the current conversation.
6. Use **Overview** for durable personal history.
7. For a complete historical backfill, run **Token Lens: Rebuild local usage
   ledger from all Copilot history** once before the pitch or first evaluation.

## Tabs

### Live

The primary real-time surface.

- **Next-turn forecast** compares the latest fully metered input with the next
  expected input. It also shows a prediction range and measured historical
  accuracy when enough real turns are available.
- **Context weight** shows context currently carried in the chat relative to the
  source-reported model limit. Every subsequent turn resends that context. A
  sharp drop indicates Copilot summarization/reset.
- **Where tokens go** shows the input categories Copilot reports, such as system
  instructions, tool definitions/results, history/messages, and files. These are
  request-level categories, not exact per-MCP token splits.
- **Total cost** switches between workspace, active chat, and today. It shows
  known tokens, Copilot AICs, and a dollar estimate using the configured local
  rate.
- **Live Copilot data** shows model and reasoning effort only when the source
  records them.

### Overview

The durable local personal ledger.

- Time ranges: Today, 7 days, 30 days, All.
- Totals: known metered tokens, provider-native AICs, configured dollar cost.
- Coverage: fully metered, input-only, output-only, genuinely in-flight, and
  usage-unavailable requests.
- Dimensions: application, provider/model, and local project alias.
- Source health: adapter status, session count, and supported capabilities.
- Recent activity: a collapsed, durable cross-chat timeline containing content-free metadata only.
- **Export all**: choose JSON or CSV and a local destination. The action exports
  all retained records, independent of the selected Overview time range.
- Local diagnostics: record count, storage size, and manual retention policy.

Overview can remain available while capture is paused.

### Turns

Transient active-chat detail:

- turn number;
- prompt excerpt;
- input/context tokens or known partial direction;
- change from the previous turn.

Prompt excerpts in Turns are read from the active source and held in memory.
They are not persisted to the local ledger and are not exported.

### Profiles

Optional advanced attribution. Profiles label whole requests using explicit
workflow evidence and participating tool groups. They do not alter immutable
ledger facts and cannot produce exact per-MCP token splits.

Built-ins include FD&E HQ and All MCP tools. Custom groups can be configured in
settings. Profiles are off by default and are not required for core usage.

### Info

The in-product condensed manual. It also labels capabilities as Core, Useful,
Advanced, or Deferred.

## Number labels

| Label | Meaning |
| --- | --- |
| **Metered** | Written by the source application. |
| **Predicted / est.** | Computed locally, not provider metering. |
| **Input measured / output measured** | The request completed, but the source persisted only that token direction. |
| **In flight** | A recent request exists and source metering has not finished. |
| **Usage unavailable** | The request completed, but the source did not persist a usable token meter. |
| **Known cost** | Cost includes only the independently measured directions or configured allocations available. |
| **Cost (est.)** | Known units multiplied by the locally configured rate. |
| **Unpriced** | Activity exists but no defensible external allocation rate is configured. |
| **AIC** | Copilot AI Credit, retained as the provider-native charge unit. |

## Controls and commands

### Normal controls

- **Capture on/off**: privacy boundary for new source reads. Existing ledger data
  remains available while paused.
- **Open dashboard**: focuses Token Lens.
- **Pin to this chat / Unpin**: resolves same-folder/multi-window ambiguity for
  Live.

### Secondary lifecycle controls

- **Export local usage ledger**: the same action as Overview's **Export all**;
  manually save every retained record as metadata-only JSON or CSV.
- **Clear local usage ledger**: confirmed deletion of Token Lens metadata only.
  Copilot files are not changed. A watermark prevents old history from
  immediately returning.
- **Rebuild local usage ledger from all Copilot history**: removes the watermark
  and explicitly rescans all currently available local Copilot workspaces. Run
  this once after upgrading from 0.8.1 so old derived status labels are replaced.

### Support controls

- **Capture self-test**: confirms the active chat parser and reports full/partial
  metering.
- **Show capture diagnostics**: current scope, sessions, watcher, and ledger
  counts.
- **Show local ledger diagnostics**: local root, observations, records, files,
  bytes, duplicates, malformed partitions, conflicts, retention, and adapter
  capabilities.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `tokenlens.passiveCapture.enabled` | `true` | Allow automatic local Copilot reads. |
| `tokenlens.capture.scope` | `window` | Keep normal live capture isolated to the current workspace. |
| `tokenlens.impact.usdPerMillionTokens` | `0.58` | Preferred local dollar projection per million known tokens. |
| `tokenlens.impact.usdPerCredit` | `0` | Fallback dollar projection per Copilot AIC when token rate is zero. |
| `tokenlens.businessTools.enabled` | `false` | Enable optional Profile attribution. |
| `tokenlens.businessTools.enabledGroups` | `[]` | Selected built-in/custom profiles. |
| `tokenlens.businessTools.customGroups` | `{}` | Advanced custom workflow/tool matching. |
| `tokenlens.businessTools.rates` | `{}` | Optional external allocation assumptions. |

Rates are projections and are not provider invoices.

## Privacy

Durable observations and exports exclude:

- prompt and assistant response text;
- code and document content;
- tool arguments;
- raw workspace paths and raw session IDs;
- user and machine identifiers.

They include metadata needed for personal accounting: timestamps, application,
provider/model, local project alias, token quantities and provenance,
provider-native charge units, content-free tool names/status/duration, and
workflow evidence labels.

Nothing is uploaded automatically. There is no account, central service, team
view, or cloud sync.

## Known limitations

- Exact tokens per individual MCP call are unavailable because current Copilot
  tool events contain no per-call token meter.
- Agency Copilot CLI and Microsoft Scout are not adapters in 0.8.3.
- Visual Studio, JetBrains, and other assistants are not measured.
- Some completed requests expose only input or output metering; Token Lens keeps
  the available direction and labels the result partial.
- Dollars depend on your configured local rate unless a provider-native charge
  and rate are available.
- Two VS Code windows on the same folder share Copilot source storage. Use Pin
  for Live; the ledger itself deduplicates equivalent observations.

## What is essential versus optional

### Core product

- Live forecast and context weight.
- Where tokens go.
- Measured tokens, AICs, and configured cost.
- Persistent personal Overview.
- Application/model/project breakdowns.
- Data coverage and source health.
- Turns and capture privacy control.

### Useful secondary

- Forecast accuracy and the experimental reset-zone indicator. It is a proximity
  hint, not reliable prediction of every Copilot summarization.
- Pin/unpin.
- Configurable cost basis.
- Manual export.

### Advanced / support

- Profiles and external allocations.
- Custom group JSON configuration.
- Clear/rebuild.
- Diagnostics and self-test.

### Deferred

- Cloud sync and multi-device merging.
- Team or leadership dashboards.
- Second AI application adapter.
- Exact per-MCP tokens.
- Agency CLI/Scout metering.
- Invoice reconciliation and automated chargeback.

## Tomorrow's pitch path

1. Start on **Live** with a real, fully metered chat containing at least five
   turns.
2. Show Last metered → Next estimated, context weight, and Where tokens go.
3. Point to the visible capture toggle as the privacy boundary.
4. Switch to **Overview** and show Today/30 days, model/project drivers, and
   source health.
5. Briefly show **Turns** as proof of per-turn tracking.
6. Keep Profiles, export, clear/rebuild, and diagnostics for Q&A.

Use measured data. Do not present preview fixture numbers as real usage.
