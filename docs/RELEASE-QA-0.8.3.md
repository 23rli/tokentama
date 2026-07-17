# Token Lens 0.8.3 — demo release QA

_Date: July 16, 2026_  
_Decision: **GO after Developer: Reload Window and Capture self-test**_

## Final artifact

- File: `tokentama-0.8.3.vsix`
- Size: 120,441 bytes
- SHA-256: `D0BFD30B379EBE35B7095CE766FE31DAE4CF2B8585B2C06B98FF961ED7D43C4E`
- Installed extension: `tokentama.tokentama@0.8.3`
- Installed extension/webview bundles are byte-identical to the final VSIX.

## Automated release gates

| Gate | Result |
| --- | --- |
| VS Code Problems | No errors |
| Strict TypeScript | Pass |
| Vitest | 26 files, 135 tests passed |
| Production esbuild | Pass |
| Bundled activation/lifecycle smoke | Pass |
| Registered command audit | All 10 commands present |
| JSON export command path | Pass; versioned metadata-only contract |
| CSV export command path | Pass; includes `metering_status`, no content columns |
| Production dependency tree | Preact 10.29.4 only |
| Production npm audit | 0 vulnerabilities |
| Patch whitespace | Pass; line-ending notices only |
| Workspace markdown links | 12 files, 0 broken relative links |

## Actual local-data integrity and privacy

A read-only source projection and stored-ledger audit reported:

- Source projection: 44 chats / 643 logical records
  - 541 fully metered
  - 88 output-only
  - 14 usage unavailable
  - 0 pending
- Stored ledger: 754 unique observations / 638 logical records / 3 files
  - 537 fully metered
  - 88 output-only
  - 13 usage unavailable
  - 0 pending
  - 0 malformed lines
- Stored-record privacy scan:
  - 0 forbidden content keys
  - 0 raw path values
  - 0 local user/machine identity values
  - CSV has no prompt/response/code/document/tool-argument/raw-path columns
  - CSV includes explicit metering status

The small source/stored count difference is newly observed source activity since the last installed-host sync, not corruption. Reloading the window lets the installed extension sync it.

## Performance and forecast regression

### Ledger benchmark

Synthetic 100,000 observations / 50,000 logical records:

- materialization: 261.6 ms
- warm Overview query: 131.3 ms

### Current local forecast corpus

- 10 chats / 381 turns / 371 predictions
- overall median error: 4.3%
- 86% within ±20%
- segmented 12-chat / 394-prediction lab:
  - steady: 2.7% median error; 94% within ±20%
  - surge: 13.0% median error; 68% within ±20%
  - reset: known failure mode
  - emitted interval coverage: 88%
  - model calls/tokens used by forecast: 0

The expanded corpus exposed that reset-zone detection is not reliable: 1/10 resets caught with 24 false alarms. Product and documentation wording was corrected during QA. Do not sell or demo the reset-zone indicator as prediction; use interval and confidence as the uncertainty story.

## Visual and accessibility QA

Browser preview exercised all five surfaces at an extreme 320 × 760 viewport:

- Live: no horizontal overflow
- Overview: no horizontal overflow
- Turns: no horizontal overflow
- Profiles: no horizontal overflow
- Info: no horizontal overflow

Verified:

- top tabs: Arrow Left/Right, Home, End, focus movement, selected state;
- Overview ranges: Arrow Left/Right, Home, End, focus movement, `aria-controls`, and labelled panel;
- collapsed Recent Activity expands natively;
- Overview `Export all` is enabled with records and emits `{ type: "exportLedger" }`;
- explicit metering labels render correctly;
- Profiles and Total Cost remain readable at narrow widths;
- strict webview CSP uses `default-src 'none'` and a cryptographic script nonce.

## VSIX contents and security audit

- Manifest version: 0.8.3
- Main bundle exists.
- 17 extension payload files; all required runtime files, docs, and icons present.
- 0 source, script, dependency, map, preview-fixture, or internal-review files included.
- 9 packaged markdown documents; 0 broken relative links.
- 0 executable `fetch`, `XMLHttpRequest`, or `WebSocket` references in production bundles.
- 0 non-W3C service URLs in production bundles.
- 0 telemetry/Application Insights calls in production bundles.

## Release-blocking fixes made during this QA

1. Corrected overconfident reset-risk product, benchmark, manual, feature, pitch, and one-pager wording.
2. Changed the UI warning from “summarization likely next” to a possible reset-zone hint.
3. Removed narrow-sidebar overflow from Profiles tables and Total Cost tiles.
4. Completed keyboard and ARIA behavior for Overview time ranges.
5. Expanded activation smoke coverage through real JSON and CSV export paths.
6. Added actual-ledger content/key/path/identity privacy auditing.

## Honest non-blocking limits

- GitHub Copilot Chat in VS Code is the only source adapter.
- Exact per-MCP-call tokens are unavailable from the current source.
- Dollars are local projections using the configured rate, not invoices.
- Forecast resets and large tool-result surges remain unpredictable.
- Profiles are evidence-based whole-request correlation, not causal per-tool billing.
- The newly installed extension does not run in an already-loaded extension host until the window reloads.

## Required two-minute pre-demo checklist

1. Run **Developer: Reload Window**.
2. Wait for Token Lens to show **live** rather than loading/stale.
3. Run **Token Lens: Capture self-test**; require PASS.
4. Keep **Capture on** and `tokenlens.capture.scope = window`.
5. Open one real chat with at least five completed, fully metered turns.
6. Open **Live → Overview → Turns** once before presenting.
7. If demonstrating export, save to a disposable local destination and choose JSON first.
8. Do not present preview-fixture values as real data.
9. Do not lead with Profiles or the reset-zone indicator.
10. Keep the one-pager open as the fallback narrative.

## Demo decision

**GO.** No code, package, privacy, dependency, data-integrity, responsive-layout, or documentation blocker remains. The only mandatory operational step is reloading VS Code so the final installed 0.8.3 bundles are active, followed by the Capture self-test.
