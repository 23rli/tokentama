# Token Lens — Known Issues & Edge Cases

A catalog of potential errors, edge cases, and limitations, with cause, status, and
workaround. Status legend: **Fixed** · **Mitigated** (handled but has a residual) ·
**Inherent** (a limitation of the data source, not a bug we can fix locally).

---

## Data source & scoping

### 1. A new *empty* window (no folder)
- **Symptom (old):** A blank window used to show the previous window's chat and aggregate every workspace's sessions ("weird chats").
- **Cause:** An empty window has no workspace hash to scope by, so it fell back to the globally-newest session and a global "All chats" total.
- **Status:** **Mitigated.** Empty windows now ignore sessions last modified before the window opened. This prevents immediate inheritance of an old chat and keeps the initial state empty.
- **Residual:** Copilot's files contain no empty-window identity. A chat modified in another window after this one opens can therefore still be selected. Full isolation comes from opening a folder; pinning helps after the intended chat is visible.

### 2. Two windows on the *same folder* track the same chat
- **Symptom:** Both windows show the same session; one can "steal" the other.
- **Cause:** VS Code stores a folder's Copilot chats under one shared workspace hash, so both windows read the same files and both follow the newest chat in that hash.
- **Status:** **Inherent.** There's no per-window signal on disk to tell the two apart.
- **Workaround:** Use one window per folder (VS Code discourages duplicates anyway), or choose **Pin current chat** from **Token Lens: Manage data and diagnostics…**.

### 3. Two *empty* windows both actively chatting can interfere
- **Symptom:** The dashboard jumps between the two chats.
- **Cause:** Neither has a workspace hash, so both follow the globally-newest chat.
- **Status:** **Inherent** (rare). Open a folder in at least one for isolation, or use **Pin current chat** from the management hub.

### 4. Only VS Code's GitHub Copilot is supported
- **Symptom:** No data in other editors (Visual Studio, JetBrains) or other AI assistants.
- **Cause:** Token Lens reads VS Code Copilot's on-disk logs (`chatSessions` + transcripts with `promptTokenDetails`). No other tool writes that format.
- **Status:** **Inherent.** See [IDE-PORTABILITY.md](IDE-PORTABILITY.md).

### 5. Rebuild is a best-available local scan, not an account-history restore
- **Symptom:** Rebuild contains fewer chats than the user remembers creating.
- **Cause:** Token Lens can read only Copilot source files still retained in this VS Code profile on this machine. Copilot may leave empty session shells, omit metering fields, compact history, or remove old local files; there is no supported remote history API for Token Lens to backfill from.
- **Status:** **Mitigated.** Token Lens scans both `chatSessions` and transcripts, including chat-session-only records, and reports the recovered session-file and usage-record counts. Data no longer present locally is inherently unrecoverable.

---

## Metering & timing

### 6. Your latest turn shows as "pending" / the estimate lags a beat
- **Symptom:** The turn you just sent briefly shows `…` / **in flight** and the next-turn estimate does not move immediately.
- **Cause:** A turn only becomes *metered* once Copilot writes its real `promptTokens` to disk — which happens as the turn finishes, a moment after you hit send. The text-only estimate (~your message length) would be wildly wrong for agent turns, so we don't fake it.
- **Status:** **Inherent** (by design). Token Lens permits at most one recent unmatched request to be **in flight**. Completed requests with no usable source meter are instead labelled **usage unavailable**.

### 7. A "Context recap" turn you never typed appears in History
- **Symptom:** Turn 0 (or an early turn) is a "Context recap — what I've asked so far…" you didn't write.
- **Cause:** That's **Copilot's own auto-summarization**. When a chat gets long, Copilot compacts it and injects a synthetic recap.
- **Status:** **Inherent.** It's real context (and real tokens), so it's shown honestly.

### 8. Turn numbers reset / History looks like it jumps back
- **Symptom:** The turn counter drops (e.g. 40 → 12) and old turns seem to vanish.
- **Cause:** Each Copilot summarization/compaction **renumbers** turns from the new recap.
- **Status:** **Inherent.** The "context weight" graph shows these resets as sawtooth drops.

### 9. MCP calls have no per-call token total
- **Symptom:** Token Lens can show that WorkIQ, ADO, Kusto, or another MCP tool ran, but cannot show "this MCP call used 12,345 tokens."
- **Cause:** VS Code's transcript records tool name, arguments, start/completion, success, and timestamps, but no token, credit, usage, billing, or meter field. Copilot stores tokens separately at the surrounding request level.
- **Available detail:** Copilot exposes aggregate input categories named `Tool Definitions` and `Tool Results`, but not a split by server or individual call. Definitions may include tools that were offered but never invoked; results from several local and MCP tools can share one category.
- **Status:** **Inherent.** Per-MCP token attribution requires Copilot or the MCP host to emit a request/subturn usage record and correlation ID. Token Lens labels current workflow attribution as correlated, not causal.

### 10. Agency Copilot CLI usage is outside VS Code Chat totals
- **Symptom:** An FD&E HQ workflow launched through **Agency: Copilot CLI** does not appear in Token Lens, even though an Agency terminal session exists.
- **Cause:** The CLI uses a separate session store. Its local schema contains sessions, turns, file references, and summaries, but no token or credit columns; Agency's local MCP/session telemetry likewise exposes calls and duration, not token or billing units.
- **Status:** **Inherent today.** A CLI adapter can recover activity and outcomes, but not authoritative token totals until the CLI or provider persists usage.
- **Workaround:** Run the workflow in VS Code GitHub Copilot Chat when live token metering is required.

### 11. Some completed requests have only one metered token direction
- **Symptom:** A completed turn is labelled **input measured** or **output measured** instead of fully metered.
- **Cause:** Copilot can persist `completionTokens` while omitting `promptTokens`, credits, and the category breakdown (or vice versa). This is a source-data gap, not a pending request.
- **Status:** **Mitigated.** Token Lens includes every independently metered direction instead of dropping the whole request. Totals sum measured directions only; forecasting and context graphs still require fully metered input.

### 12. Older ledger data shows several requests as pending after upgrade
- **Symptom:** An older 0.8.1 install reports multiple pending requests even though no Copilot work is running.
- **Cause:** The old projection used a no-meter fallback that conflated completed source gaps with active requests.
- **Status:** **Fixed in 0.8.2.** Choose **Rebuild from available local history** from the management hub once. This replaces only Token Lens's derived metadata and never edits Copilot source files.

### 13. Dashboard felt frozen until a reload (older builds)
- **Symptom:** Stats stuck several turns behind; only updated on click/reload.
- **Cause:** (a) installs don't take effect until the window reloads; (b) earlier builds refreshed too slowly / only on focus.
- **Status:** **Fixed.** Now refreshes every ~1.5s + on focus + on panel show. A green **live** dot shows it's updating; it turns amber with "updated Ns ago" if the pipeline actually stalls.
- **Note:** Any new build still requires **Developer: Reload Window** to run.

### 14. The reset-zone indicator does not predict every summarization
- **Symptom:** Copilot may summarize even when no reset-zone warning appeared, or the warning may appear without an immediate reset.
- **Cause:** Summarization is not exposed as a pre-turn source signal. The indicator can only use model-relative context proximity and previously observed history.
- **Status:** **Experimental.** The July 16 expanded-corpus run caught 1 of 10 resets and produced 24 false alarms. Treat the interval and confidence as the primary uncertainty signals; do not present the indicator as reliable reset prediction.

---

## Cost & numbers

### 15. The $ figure looks too high/low
- **Symptom:** Cost doesn't match your real Copilot bill.
- **Cause:** Dollars are derived from a **blended $/million-tokens rate** (`tokenlens.impact.usdPerMillionTokens`, default 0.58). The default is one observed data point; your effective rate differs by plan/model/caching.
- **Status:** **By design.** Set `tokenlens.impact.usdPerMillionTokens` to your own effective rate for accuracy (or `0` to fall back to a per-credit rate).

### 16. Cost tiles show 0 / "—" briefly on startup
- **Symptom:** Total cost is empty before a chat loads.
- **Cause:** Zero-state fallback until the on-disk forecast lands.
- **Status:** **Expected.** Fills in within ~1.5s once a session is read.

### 17. Reasoning effort shows blank
- **Symptom:** "Live Copilot data" shows the model but no reasoning effort.
- **Cause:** We only show the effort when the session actually recorded which one was used (many turns don't). We never show the supported *range* (that read as misleading "low–max").
- **Status:** **By design.**

---

## Configuration & upgrade

### 18. My settings reset after an update
- **Symptom:** A previously-set `$/million-tokens` rate reverted to default.
- **Cause:** The v0.6.0 rename changed config keys from `tokentama.*` to `tokenlens.*`. Old values under the old keys are no longer read.
- **Status:** **One-time.** Re-set under the new `tokenlens.impact.*` keys.

### 19. Toggling "Capture off" affects other windows
- **Symptom:** Disabling capture in one window disables it everywhere.
- **Cause:** The capture toggle writes to the **global** setting (`tokenlens.passiveCapture.enabled`).
- **Status:** **By design** (it's a global preference).

---

## Environment

### 20. No data at all
- **Likely causes:** capture is off; no GitHub Copilot Chat sessions on disk yet; running in a remote/container where the storage path differs; the extension build isn't loaded (needs a window reload).
- **Diagnose:** Open **Token Lens: Manage data and diagnostics…**, then run **Check capture health** and **Test current chat capture**.

### 21. Extension needs a reload after every install
- **Cause:** VS Code loads extension code once per window; `--install-extension` updates the file but the running host keeps the old code.
- **Status:** **Inherent to VS Code.** Run **Developer: Reload Window** after installing a new build.
