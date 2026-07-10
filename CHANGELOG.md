# Change Log

All notable changes to the Token Lens extension are documented here.

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
