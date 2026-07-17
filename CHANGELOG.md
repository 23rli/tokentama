# Change Log

All notable changes to the Token Lens extension are documented here.

## [0.8.3] - 2026-07-16

### Added

- Added **Export all** directly to Overview. Users can choose metadata-only JSON
  or CSV and select a local destination; export remains manual and never uploads.
- Added explicit `metering_status` to CSV export rows.
- Consolidated the complete product journey, explored paths, shipped feature
  inventory, architecture, achieved evidence, boundaries, and future potential
  in the app journey and direction document.
- Added a leadership-ready sales one-pager with the problem, product value,
  differentiation, validation evidence, current boundaries, and pilot ask.

### Changed

- Kept Recent Activity as the only durable cross-chat timeline, but collapsed it
  by default so aggregate Overview data remains the primary surface.
- Updated the in-product Info manual with exact 0.8.3 coverage and export behavior.
- Corrected reset-risk wording after an expanded-corpus QA run showed the
  proximity signal is experimental; interval and confidence remain primary.
- Removed horizontal overflow from Profiles and Total Cost at narrow sidebar
  widths and completed arrow/Home/End keyboard behavior for Overview ranges.
- Expanded bundled activation smoke coverage through real JSON and CSV export
  command paths and their privacy/status contracts.

## [0.8.2] - 2026-07-16

### Fixed

- Replaced the ambiguous no-meter fallback with explicit `metered`, `input-only`,
  `output-only`, `pending`, and `unavailable` states across Live, Turns, and the
  personal ledger.
- Limited **in flight** to a genuinely current unmatched request. Completed
  requests with missing source meters are now labelled **usage unavailable**
  rather than pending.
- Reconciled Copilot source requests with transcript turns by stable request
  evidence instead of assuming their array positions always match.
- Reconstructed appended Copilot request arrays correctly and ignored automatic
  continuation controls that are not independent metered requests.
- Preserved the original session-start timestamp for an omitted first prompt.

### Changed

- Replaced trailing `+` markers with explicit **input measured**, **output
  measured**, **known cost**, and **usage unavailable** labels.
- Added separate coverage counts for fully metered, input-only, output-only,
  genuinely in-flight, and unavailable records.
- Rebuild now reprojects available Copilot history with the corrected request
  identity and metering-status semantics; Copilot source files remain read-only.

## [0.8.1] - 2026-07-16

### Changed

- Made Live the first/default tab, followed by Overview, Turns, Profiles, and Info.
- Replaced accumulated Info copy with a compact collapsible in-product manual.
- Moved Profiles and lifecycle/support features out of the primary pitch path
  while retaining them for advanced use and Q&A.

### Added

- Complete user manual covering all tabs, labels, controls, settings, privacy,
  known limits, and tomorrow's demo flow.
- Internal pitch feature audit classifying visible capabilities as core, useful,
  advanced, deferred, or inert cleanup.

## [0.8.0] - 2026-07-16

### Added

- Versioned, append-only, metadata-only local AI usage ledger in VS Code global
  extension storage, retained until the user explicitly clears it.
- Source-adapter contract plus the first adapter for VS Code GitHub Copilot Chat.
- Deterministic request identity, duplicate suppression across rescans/windows,
  pending-to-metered revisions, canonical fingerprints, conflict reporting, and
  malformed-partition recovery diagnostics.
- Personal Overview with Today / 7 days / 30 days / All scopes, applications,
  models, projects, source health, metering coverage, recent metadata-only
  activity, ledger size, and retention status.
- Explicit metadata-only JSON/CSV export, clear, rebuild, and ledger diagnostic
  commands. Export remains manual and local.

### Changed

- Made Live the default first tab and Overview second for the pitch and normal
  developer workflow.
- Generalized Business Tools to optional Profiles. FD&E HQ remains available as
  one profile but is no longer preferred by the product UI.
- Replaced accumulated Info copy with a collapsible in-product manual and added
  full user-manual and pitch-feature-audit documents.
- Persistent records omit prompts, responses, code/document content, tool
  arguments, raw paths, raw session IDs, user IDs, and machine IDs.

## [0.7.3] - 2026-07-15

### Added

- Mutually exclusive request-level attribution for selected groups versus Other
  Copilot, enabling an FD&E HQ versus Other measured-spend comparison without
  fabricating per-MCP token splits.
- Evidence tiers: explicit workflow (high confidence), tool-associated (medium),
  mixed selected groups (low), and unattributed Other.
- Known spend share, turns, MCP calls, token totals, partial markers, and
  confidence labels for every attribution bucket.

### Changed

- Renamed the business panel to a workflow cost envelope and clarified that
  external dollars are configured allocations rather than provider billing.

## [0.7.2] - 2026-07-15

### Fixed

- Preserved independently metered completion usage when Copilot omits the input
  token field; these requests were previously dropped from all totals.
- Added explicit partial/known-minimum labels to scope totals, turn history, and
  business workflow Copilot costs.

### Documented

- MCP transcript events contain no per-call token or billing fields; Copilot's
  `Tool Definitions` and `Tool Results` categories are request-level aggregates.
- Agency Copilot CLI storage currently contains activity but no token or credit
  columns, so CLI usage is outside authoritative Token Lens totals.

## [0.7.1] - 2026-07-15

### Changed

- Made business-tool attribution opt-in and independently switchable from core
  Copilot token capture.
- Replaced the fixed catalog with selectable groups: FD&E HQ, All MCP tools, and
  schema-validated custom groups supplied through workspace settings.
- Added custom service/workflow matching, group labels, deterministic precedence,
  and group/service rate overrides so future toolsets require no code changes.
- Restricted group totals to matching workflows and tool calls; unrelated
  Copilot turns no longer appear in a selected business group.

## [0.7.0] - 2026-07-15

### Added

- Business Tools tab with workspace, current-chat, and today scopes.
- Privacy-safe attribution for standard MCP services and loaded VS Code skills.
- Workflow-level Copilot cost for explicit skills, agents, and saved prompts.
- Service call counts, success, observed runtime, and local configurable
  per-call/per-minute marginal rates.
- Honest partial-cost handling: calls without a rate remain visibly unpriced.

## [0.6.10] - 2026-07-10

### Changed

- Finalized the QA-approved early user-testing package and raised the bundled
  Preact version to 10.29.4.
- Replaced the deprecated creature artwork with a neutral meter icon.

## [0.6.9] - 2026-07-10

### Added

- Workspace / current-chat / today cost scopes.
- Info tab, chat pinning, capture diagnostics, and a capture self-test for pilots.
- Empty-window scoping tests and bundled-extension activation smoke coverage.

### Fixed

- Capture off now stops every periodic Copilot disk read, not only the file watcher.
- Credit totals are labelled estimated whenever any included turn uses fallback pricing.
- The configured per-AIC USD rate now works when the per-token rate is disabled.
- In-flight prompts are labelled **Current turn (est.)** rather than being presented as
  an unsent next-turn prediction.
- Today totals no longer use a mutable session-file timestamp for early prompts.
- Stale chat/model state is cleared when no chat remains in scope.
- Scope and capture setting changes take effect without reloading the window.
- Last-turn deltas now use total tokens and a directly derived USD value, matching the
  units displayed by the cost tiles.
- Strict lifecycle cleanup for timers, store listeners, the watcher, and webview provider.
- Keyboard-accessible tabs, visible focus states, responsive tooltips, improved contrast,
  reduced-motion handling, and screen-reader labels for charts and progress indicators.
- The smoke test now validates the current Token Lens commands instead of a removed
  EcoPrompt scoring command.
- Raised the Preact dependency floor to 10.29.2, beyond versions affected by
  `GHSA-36hm-qxxp-pg3m`.
- Updated esbuild to 0.28.1 and Vitest to 4.1.9 so the development toolchain no
  longer resolves the old esbuild development-server advisory range.

## [0.6.0] - 2026-07-09

### Changed

- Renamed command, view, and configuration IDs from `tokentama.*` to `tokenlens.*`.
- Removed the legacy carbon/water estimates and simplified state to the live cost forecast.
- Defaulted capture to window-scoped storage to prevent unrelated windows inheriting stats.

## [0.5.0] - 2026-07-09

### Changed

- Removed the unused pet, scoring, coaching, corpus, telemetry, and outcomes runtime paths.
- Reduced the dashboard to measured token visibility, model context, and forecasting.

## [0.2.1] - 2026-07-08

### Fixed

- Corrected context-breakdown bars so each scope fills consistently.

## [0.2.0] - 2026-07-08

### Changed

- Pivoted from prompt-efficiency scoring to real-time Copilot cost visibility and
  model-agnostic next-turn forecasting.

## [0.1.0] - 2026-06-21

### Added

- Initial experimental VS Code extension scaffold and local Copilot log ingestion.
