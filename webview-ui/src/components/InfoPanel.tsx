/** Compact in-product manual. The full reference ships in docs/USER-MANUAL.md. */
export function InfoPanel() {
  return (
    <div class="info info-manual">
      <section class="card info-card info-start">
        <span class="section-title" role="heading" aria-level={2}>Token Lens manual</span>
        <p class="info-lead">
          Token Lens is a private local ledger plus a live GitHub Copilot meter. Start on
          <b> Live</b> for the current chat, then use <b>Overview</b> for durable personal history.
        </p>
        <ol class="info-steps">
          <li>Send a Copilot Chat request and let it finish.</li>
          <li>Open <b>Live</b> to see the last measured turn, next-turn forecast, and context load.</li>
          <li>Open <b>Overview</b> to compare usage over Today, 7 days, 30 days, or All.</li>
        </ol>
      </section>

      <details class="card info-card info-fold" open>
        <summary>What each tab is for</summary>
        <ul class="info-list">
          <li><b>Live</b>: current Copilot chat, forecast, context weight, token categories, totals, and model.</li>
          <li><b>Overview</b>: persistent metadata-only history by time, application, provider/model, and project, plus a collapsed cross-chat activity timeline and export.</li>
          <li><b>Turns</b>: transient prompt excerpts and context deltas for only the active chat. Excerpts are not persisted or exported.</li>
          <li><b>Profiles</b>: optional advanced attribution for selected workflows and toolsets. Not required for core tracking.</li>
          <li><b>Info</b>: this manual and the product's measurement boundaries.</li>
        </ul>
      </details>

      <details class="card info-card info-fold" open>
        <summary>How to read the numbers</summary>
        <div class="info-definitions">
          <div><b>Metered</b><span>Written by the source application.</span></div>
          <div><b>Predicted</b><span>Local next-turn forecast, always shown as estimated.</span></div>
          <div><b>Cost (est.)</b><span>Known tokens or credits multiplied by your configured local rate.</span></div>
          <div><b>Input measured</b><span>The request completed with only its input direction metered.</span></div>
          <div><b>Output measured</b><span>The request completed with only its output direction metered.</span></div>
          <div><b>In flight</b><span>One genuinely current unmatched request may appear while Copilot finishes writing it.</span></div>
          <div><b>Usage unavailable</b><span>The request completed, but Copilot did not persist a usable token meter.</span></div>
          <div><b>Unpriced</b><span>Activity was observed, but no defensible external rate is configured.</span></div>
        </div>
      </details>

      <details class="card info-card info-fold">
        <summary>Live cards</summary>
        <ul class="info-list">
          <li><b>Next-turn forecast</b>: last real input versus the next expected input, range, and measured accuracy.</li>
          <li><b>Context weight</b>: context currently re-sent on every turn, relative to the model limit. Drops indicate Copilot summarization.</li>
          <li><b>Where tokens go</b>: source-reported input categories such as system instructions, tool definitions/results, history, messages, and files.</li>
          <li><b>Total cost</b>: known tokens, Copilot AICs, and configured dollar estimate for workspace, current chat, or today.</li>
          <li><b>Live Copilot data</b>: model and reasoning effort only when the source records them.</li>
        </ul>
      </details>

      <details class="card info-card info-fold">
        <summary>Controls and commands</summary>
        <ul class="info-list">
          <li><b>Capture on/off</b>: controls new source reads. Existing ledger history remains available when paused.</li>
          <li><b>Manage…</b>: one searchable hub for pin/unpin, export, rebuild, clear, settings, self-test, and diagnostics.</li>
          <li><b>Rebuild from available local history</b>: rescan Copilot history still available on this machine; it cannot restore source files Copilot already removed.</li>
          <li><b>Export all</b>: from Overview, choose metadata-only JSON or CSV and a local destination. It exports all retained records, not only the selected time range.</li>
          <li><b>Clear local usage ledger</b>: confirmed deletion of Token Lens metadata only; Copilot source files are untouched.</li>
          <li><b>Diagnostics / self-test</b>: support actions inside Manage, not normal workflow steps.</li>
        </ul>
      </details>

      <details class="card info-card info-fold">
        <summary>Core, advanced, and deferred</summary>
        <div class="info-status-list">
          <div><span class="info-status core">Core</span><p>Live forecast, context weight, token breakdown, measured totals, personal Overview, source health, Turns, and capture privacy control.</p></div>
          <div><span class="info-status useful">Useful</span><p>Pin/unpin, manual export, configurable rates, forecast accuracy, and the experimental reset-zone indicator.</p></div>
          <div><span class="info-status advanced">Advanced</span><p>Profiles, external allocations, custom tool groups, clear/rebuild, and diagnostics. Keep these out of the main pitch unless asked.</p></div>
          <div><span class="info-status defer">Deferred</span><p>Cloud sync, team dashboards, exact per-MCP token splits, Agency CLI/Scout metering, and invoice-grade external billing.</p></div>
        </div>
      </details>

      <details class="card info-card info-fold">
        <summary>Privacy and known limits</summary>
        <ul class="info-list">
          <li>Durable records exclude prompts, responses, code/documents, tool arguments, raw paths/session IDs, user IDs, and machine IDs.</li>
          <li>GitHub Copilot Chat is the only source adapter in 0.8.3.</li>
          <li>MCP calls are visible, but Copilot does not expose exact tokens per individual MCP call.</li>
          <li>Dollars are local projections unless a provider-native charge is available; they are not an invoice.</li>
          <li>Profiles correlate whole requests with evidence. They do not prove causal per-tool spend.</li>
        </ul>
      </details>
    </div>
  );
}
