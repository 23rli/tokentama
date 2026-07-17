# Token Lens

## See AI usage while it happens. Keep an honest record afterward.

**Token Lens is a private VS Code observability layer for personal AI work.** It turns local GitHub Copilot records into live visibility and a durable metadata-only usage ledger—without uploading prompts, code, documents, or tool arguments.

### The problem

AI coding is becoming everyday engineering infrastructure, but its consumption remains a black box:

- bills and quotas arrive after the work, not while an interaction is growing;
- agentic chats silently resend context, tool definitions, and history;
- usage is fragmented across chats, projects, models, and applications; and
- useful analysis often requires exporting sensitive prompt or code history.

The result is adoption without instrumentation. Developers cannot build intuition, and platform owners lack evidence for what to govern or improve.

### The product

| Capability | Value |
| --- | --- |
| **Live** | Last measured turn, calibrated next-turn forecast, context weight, token categories, AICs, and labelled cost projections. |
| **Overview** | Today/7-day/30-day/all-time usage by application, model, and project, with explicit data coverage and source health. |
| **Turns** | Active-chat evidence showing measured usage and context growth turn by turn. |
| **Export all** | User-controlled metadata-only JSON or CSV for Excel, Power BI, notebooks, or personal analysis. |
| **Profiles** | Optional workflow cost envelopes plus participating MCP services, reliability, and duration. |

Profiles associate whole requests with observable workflow/tool evidence; they do not fabricate exact per-tool token splits.

### Why Token Lens is different

- **Measured before modeled:** source facts stay separate from forecasts and configured dollar projections.
- **Honest completeness:** missing evidence is a visible coverage state, not false precision.
- **Private by architecture:** durable records contain no prompts, responses, code, documents, arguments, raw paths, or personal identifiers.
- **Zero-token forecasting:** self-calibrating local arithmetic adds no model call.
- **Extensible foundation:** a source-neutral adapter contract can add applications without rewriting existing history or the core UI.
- **Evidence-led promise:** Token Lens exposes structural cost drivers instead of claiming prompt tricks magically eliminate them.

### Built and validated now

- Working local GitHub Copilot Chat adapter and all five product surfaces.
- Current-history validation showed **2.7% median error on steady turns** and roughly 4% across unflagged turns. Surges and resets remain known failure modes; interval and confidence communicate uncertainty.
- A synthetic benchmark exercised **100,000 observations / 50,000 logical records** with sub-second materialization and Overview queries on the development machine.
- Strict TypeScript, activation smoke testing, and **135 automated tests** cover ingestion, reconciliation, provenance, forecast, ledger, privacy, export, and UI status behavior.

These are engineering results from limited local data, not universal performance guarantees.

### Who benefits

- **Developers:** understand context growth, model usage, and likely next-turn cost.
- **AI platform and FinOps teams:** identify the measurements and governance controls worth scaling.
- **Workflow owners:** compare known AI cost envelopes, service participation, reliability, and duration.

### The ask: validate the observability layer

Run a focused local pilot with real VS Code Copilot workflows. Validate:

1. developer value from Live context and cost visibility;
2. trust and usefulness of Overview, coverage, and export;
3. workflow value from Profiles; and
4. demand for a second adapter or governed aggregate view.

**Token Lens does not ask developers to use less AI. It gives them the instrumentation to use it deliberately—and gives platform leaders evidence for what to build next.**

---

**Available today:** local VS Code GitHub Copilot Chat measurement.  
**Not claimed today:** exact per-MCP tokens, Agency CLI/Scout metering, invoice reconciliation, cloud sync, or a managed team dashboard.
