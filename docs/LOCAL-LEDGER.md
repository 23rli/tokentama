# Local personal AI usage ledger

Token Lens 0.8.4 stores a private, append-only metadata ledger under VS Code's
extension global storage. It is designed for one developer's usage on the local
machine/profile. It does not provide cloud sync, accounts, automatic uploads, or
a team dashboard.

For daily use, Live is the first tab and Overview is second. See
[USER-MANUAL.md](USER-MANUAL.md) for the complete product guide.

## Durable record contract

Each source adapter emits a versioned `UsageObservation` containing:

- stable source/application/provider identities;
- a deterministic, pseudonymous logical request ID;
- occurred and observed timestamps;
- pseudonymous project key plus a local display alias;
- model identity and reasoning effort when available;
- independently proven input/output quantities with `metered`, `estimated`, or
  `unknown` provenance;
- an explicit request state: `metered`, `input-only`, `output-only`, `pending`,
  or `unavailable`;
- provider-native charges such as Copilot AICs with metered/estimated provenance;
- content-free tool name, kind, status, and duration;
- explicit workflow/profile evidence such as skill, agent, saved prompt, or MCP
  identifier.

The contract intentionally has no field for prompt text, assistant response,
code, document content, tool arguments, raw workspace path, raw session ID, user
identity, or machine identity.

## Revisions and idempotency

AI application data arrives incrementally. A request can appear first with local
estimates, later with output metering, and later with input tokens, native
charges, and a category breakdown.

Token Lens handles that as follows:

1. A deterministic `sourceRecordId` identifies the logical source request.
2. A canonical fingerprint identifies each content-free evidence revision.
3. Rescanning unchanged source data produces the same fingerprint and is skipped.
4. New evidence appends as another observation for the same logical record.
5. Query-time materialization prefers provider-metered facts over estimates,
   preserves independently metered directions, and reports conflicting metered
   revisions instead of summing them.
6. Independent VS Code windows write separate partitions; materialization
   deduplicates identical observations across partitions.

For Copilot, source-native request IDs are used when available. A content-free
hash of stable timestamp, model, session, and workspace scope is the fallback so
turn-index renumbering does not create a new logical record. Turn index is used
only for legacy records that expose neither request ID nor a valid timestamp.

## Storage and retention

Observations are monthly JSONL partitions under:

```text
<ExtensionContext.globalStorageUri>/usage-ledger-v1/writers/<writer>/<adapter>/<YYYY-MM>.jsonl
```

One writer directory per extension-host instance avoids cross-window file write
contention. The ledger is retained until the user explicitly clears it.

- **Clear local usage ledger** deletes only Token Lens partitions and writes a
  local clear watermark. Existing old source files remain excluded after restart.
- New source observations occurring after the watermark are still recorded.
- **Rebuild local usage ledger** removes the watermark and explicitly rescans all
  currently available local Copilot workspaces. Normal live ingestion remains
  scoped to the current window so unrelated windows never drive the Live view.
- After upgrading from 0.8.1, rebuild once to replace the old derived status
  projection. This clears and recreates Token Lens metadata only.
- Copilot source files are never changed.

Malformed or truncated ledger lines are skipped, counted, and associated with a
content-free partition path in diagnostics. Unknown/future schema versions are
not interpreted as current records.

## Personal queries

Overview materializes Today, 7 days, 30 days, and All scopes with:

- known input/output/total tokens and partial coverage;
- provider-native charges and active local cost basis;
- fully metered, input-only, output-only, genuinely pending, and unavailable
  record counts;
- application, model/provider, and project breakdowns;
- source health and capability gaps;
- recent metadata-only activity;
- ledger record/observation/file counts, local bytes, malformed partitions,
  duplicates, conflicts, and retention.

Configured dollar rates are projections at query time. Changing a rate does not
rewrite measured source facts.

## Export

Export is explicit and secondary:

- Select **Export all** in Overview, or run **Token Lens: Export usage ledger**
  from the Command Palette.
- Export includes all retained records; the Overview time selector does not
  filter the file.
- JSON preserves versioned content-free materialized records and coverage.
- CSV provides flat rows for personal analysis, including explicit metering status.
- The user chooses the destination through VS Code.
- Nothing is exported automatically.

Both formats exclude source content and personal/machine identifiers. Project
aliases, model names, workflow labels, and tool identifiers are metadata and are
included so the export remains useful; users should choose a destination with
appropriate access.

## Adapter contract

Version 0.8.4 ships one adapter: VS Code GitHub Copilot Chat. Future adapters
must provide:

1. a stable adapter and application ID;
2. deterministic logical source identity and revision observations;
3. explicit capabilities for tokens, native charges, tools, and per-tool tokens;
4. field-level provenance and partial coverage;
5. a privacy projection before append;
6. source health and scan diagnostics;
7. conformance fixtures proving no source content enters the ledger.

MCP activity does not include a per-call token meter in the current Copilot
source. Tool calls may be associated with whole request usage, but exact per-MCP
tokens remain unsupported unless a future source emits them.

## Performance baseline

Run `npm run bench:ledger`. The July 16, 2026 local baseline generated 100,000
observations / 50,000 logical records:

- revision materialization: 326.4 ms;
- warm Overview query across application/model/project dimensions: 119.1 ms.

The benchmark is synthetic and machine-specific, but verifies the common query
path remains below the 200 ms target at a history size well above typical
individual use.
