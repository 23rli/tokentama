# Token Lens — Known Issues & Edge Cases

A catalog of potential errors, edge cases, and limitations, with cause, status, and
workaround. Status legend: **Fixed** · **Mitigated** (handled but has a residual) ·
**Inherent** (a limitation of the data source, not a bug we can fix locally).

---

## Data source & scoping

### 1. A new *empty* window shows another window's chat
- **Symptom:** Opening a blank window (no folder) briefly shows the last-active chat's stats.
- **Cause:** An empty window has no workspace hash to scope to, so it follows the *globally-active* Copilot chat.
- **Status:** **Mitigated.** Folder windows are fully isolated (scoped to their own workspace). Empty windows intentionally follow the active chat so they still track something. Once you start typing in the empty window, it follows *your* chat.
- **Workaround:** Open a folder in the window for full isolation.

### 2. Two windows on the *same folder* track the same chat
- **Symptom:** Both windows show the same session; one can "steal" the other.
- **Cause:** VS Code stores a folder's Copilot chats under one shared workspace hash, so both windows read the same files and both follow the newest chat in that hash.
- **Status:** **Inherent.** There's no per-window signal on disk to tell the two apart.
- **Workaround:** Use one window per folder (VS Code discourages duplicates anyway).

### 3. Two *empty* windows both actively chatting can interfere
- **Symptom:** The dashboard jumps between the two chats.
- **Cause:** Neither has a workspace hash, so both follow the globally-newest chat.
- **Status:** **Inherent** (rare). Open a folder in at least one for isolation.

### 4. Only VS Code's GitHub Copilot is supported
- **Symptom:** No data in other editors (Visual Studio, JetBrains) or other AI assistants.
- **Cause:** Token Lens reads VS Code Copilot's on-disk logs (`chatSessions` + transcripts with `promptTokenDetails`). No other tool writes that format.
- **Status:** **Inherent.** See [IDE-PORTABILITY.md](IDE-PORTABILITY.md).

---

## Metering & timing

### 5. Your latest turn shows as "pending" / the estimate lags a beat
- **Symptom:** The turn you just sent has `…`/"pending" tokens; "Next turn (est.)" doesn't move immediately.
- **Cause:** A turn only becomes *metered* once Copilot writes its real `promptTokens` to disk — which happens as the turn finishes, a moment after you hit send. The text-only estimate (~your message length) would be wildly wrong for agent turns, so we don't fake it.
- **Status:** **Inherent** (by design). History shows the turn immediately as "pending" and fills in real tokens within a second or two.

### 6. A "Context recap" turn you never typed appears in History
- **Symptom:** Turn 0 (or an early turn) is a "Context recap — what I've asked so far…" you didn't write.
- **Cause:** That's **Copilot's own auto-summarization**. When a chat gets long, Copilot compacts it and injects a synthetic recap.
- **Status:** **Inherent.** It's real context (and real tokens), so it's shown honestly.

### 7. Turn numbers reset / History looks like it jumps back
- **Symptom:** The turn counter drops (e.g. 40 → 12) and old turns seem to vanish.
- **Cause:** Each Copilot summarization/compaction **renumbers** turns from the new recap.
- **Status:** **Inherent.** The "context weight" graph shows these resets as sawtooth drops.

### 8. Dashboard felt frozen until a reload (older builds)
- **Symptom:** Stats stuck several turns behind; only updated on click/reload.
- **Cause:** (a) installs don't take effect until the window reloads; (b) earlier builds refreshed too slowly / only on focus.
- **Status:** **Fixed.** Now refreshes every ~1.5s + on focus + on panel show. A green **live** dot shows it's updating; it turns amber with "updated Ns ago" if the pipeline actually stalls.
- **Note:** Any new build still requires **Developer: Reload Window** to run.

---

## Cost & numbers

### 9. The $ figure looks too high/low
- **Symptom:** Cost doesn't match your real Copilot bill.
- **Cause:** Dollars are derived from a **blended $/million-tokens rate** (`tokenlens.impact.usdPerMillionTokens`, default 0.58). The default is one observed data point; your effective rate differs by plan/model/caching.
- **Status:** **By design.** Set `tokenlens.impact.usdPerMillionTokens` to your own effective rate for accuracy (or `0` to fall back to a per-credit rate).

### 10. Cost tiles show 0 / "—" briefly on startup
- **Symptom:** Total cost is empty before a chat loads.
- **Cause:** Zero-state fallback until the on-disk forecast lands.
- **Status:** **Expected.** Fills in within ~1.5s once a session is read.

### 11. Reasoning effort shows blank
- **Symptom:** "Live Copilot data" shows the model but no reasoning effort.
- **Cause:** We only show the effort when the session actually recorded which one was used (many turns don't). We never show the supported *range* (that read as misleading "low–max").
- **Status:** **By design.**

---

## Configuration & upgrade

### 12. My settings reset after an update
- **Symptom:** A previously-set `$/million-tokens` rate reverted to default.
- **Cause:** The v0.6.0 rename changed config keys from `tokentama.*` to `tokenlens.*`. Old values under the old keys are no longer read.
- **Status:** **One-time.** Re-set under the new `tokenlens.impact.*` keys.

### 13. Toggling "Capture off" affects other windows
- **Symptom:** Disabling capture in one window disables it everywhere.
- **Cause:** The capture toggle writes to the **global** setting (`tokenlens.passiveCapture.enabled`).
- **Status:** **By design** (it's a global preference).

---

## Environment

### 14. No data at all
- **Likely causes:** capture is off; no GitHub Copilot Chat sessions on disk yet; running in a remote/container where the storage path differs; the extension build isn't loaded (needs a window reload).
- **Diagnose:** Run **Token Lens: Show capture diagnostics** and **Token Lens: Capture self-test** from the Command Palette — they print what paths/sessions are visible.

### 15. Extension needs a reload after every install
- **Cause:** VS Code loads extension code once per window; `--install-extension` updates the file but the running host keeps the old code.
- **Status:** **Inherent to VS Code.** Run **Developer: Reload Window** after installing a new build.
