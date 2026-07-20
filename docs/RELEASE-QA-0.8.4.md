# Token Lens 0.8.4 — release QA

_Date: July 19, 2026_
_Decision: **GO**_

## Final artifact

- File: `tokentama-0.8.4.vsix`
- Size: 121,953 bytes
- SHA-256: `34AA30C1F28A184745A9071ADE0E5C098D7951EC857C031FBE9D2F66ED23290E`
- Manifest identity: `tokentama.tokentama@0.8.4`

## Automated release gates

| Gate | Result |
| --- | --- |
| VS Code Problems | No errors |
| Strict TypeScript | Pass |
| Vitest | 26 files, 138 tests passed |
| Production esbuild | Pass |
| Bundled activation/lifecycle smoke | Pass |
| Runtime command audit | 12 registered commands present |
| Public command surface | 6 useful commands: open, capture, pin/unpin, export, rebuild, manage |
| Ledger benchmark | 100,000 observations / 50,000 records; 279.5 ms materialization; 140.3 ms Overview query |
| Production dependency tree | Preact 10.29.4 only |
| Production npm audit | 0 vulnerabilities |
| Patch whitespace | Pass; line-ending notices only |
| VSIX payload | 19 files; no source, maps, scripts, dependencies, preview, or internal QA files |
| Packaged Markdown | 10 documents, 9 relative links checked, 0 missing |
| Executable network/telemetry scan | 0 fetch, XHR, WebSocket, Application Insights, or trackEvent references |

## Release changes

- Discovers Copilot sessions from both `chatSessions` and transcripts, allowing a first prompt to appear before its transcript exists.
- Refreshes Live on preliminary turns and uses a faster polling fallback.
- Rebuild scans locally retained chat-session-only sources and reports recovered session/record counts or failures.
- Keeps useful direct commands for capture, pin/unpin, export, and rebuild while consolidating destructive/support actions under Manage.
- Removes retired pet, scoring, coaching, telemetry, session-tracker, and savings-era benchmark systems.
- Replaces legacy state and context terminology with Token Lens names and removes the always-zero metrics fallback.
- Cleans stale EcoPrompt environment and monorepo lock entries; benchmark bundles now use temporary output.

## Honest limits

- Rebuild can recover only Copilot source files still retained in this VS Code profile on this machine.
- GitHub Copilot Chat in VS Code remains the only source adapter.
- Exact per-MCP-call tokens remain unavailable from the current source.
- Dollars are configured local projections, not provider invoices.
- Forecast reset behavior and large tool-result surges remain uncertain.
- A VS Code window must reload after installing the VSIX before the new extension host code runs.

## Release decision

**GO.** The exact artifact above passed all automated release gates and payload audits. After installation, run **Developer: Reload Window**, then use **Token Lens: Manage data and diagnostics… → Test current chat capture** for an operational check.
