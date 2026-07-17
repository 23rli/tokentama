# Token Lens leadership readout

_Prepared July 15, 2026 for a July 17 leadership discussion. Seven-minute
readout plus demo. All claims below are supported by the current local data
source audit; no per-MCP token estimate is presented as fact._

## The one-sentence message

**Token Lens can measure Copilot spend for a business workflow and observe which
MCP tools participated, but VS Code and Agency do not expose the data required
to divide those tokens exactly among individual MCP calls.**

That is a narrower result than exact tool billing, but it still supports useful
workflow cost visibility, adoption, reliability, latency, and cost-per-outcome
analysis. Exact per-tool allocation is now a clearly defined platform contract,
not an unsolved analytics problem.

## Recommendation

Present the current build as a **validated observability MVP**, not a finished
MCP chargeback product.

1. **Keep:** real Copilot tokens/AICs by turn, chat, workspace, and matched
   workflow; aggregate Tool Definitions/Tool Results; MCP call count, service,
   success, and duration; optional external allocation rates.
2. **Do not claim:** exact WorkIQ vs. ADO token splits, Agency CLI token totals,
   or invoice-grade external service cost.
3. **Ask leadership:** validate the workflow-observability use case now, and
   sponsor a small platform investigation only if exact per-MCP chargeback is a
   business requirement.

## What this means specifically for FD&E HQ

FD&E HQ is a strong first profile because it already provides the organizational
layer Token Lens needs: named skills, agents, saved prompts, and a declared MCP
catalog spanning WorkIQ, Azure DevOps, M365, Fabric/Kusto, security, and internal
engineering systems. Token Lens does not need FD&E HQ to emit a proprietary log;
it recognizes standard VS Code workflow and MCP signals through the optional
**FD&E HQ** group.

### The opportunity for HQ

Today, HQ can answer **what work was attempted** and **which systems were used**.
Copilot can report **what the surrounding AI request consumed**. Token Lens joins
those two views into a workflow cost envelope.

That can support an HQ scorecard such as:

| FD&E question | Available now | Follow-up needed |
| --- | --- | --- |
| Which HQ workflows are being used? | Explicit `fde-*` skill, `@agent`, and `/prompt` attribution | Broader adoption reporting requires an approved aggregate store |
| What Copilot spend is associated with project intake or board hygiene? | Measured request-level tokens/AICs for matched VS Code Chat turns | Exact split among calls is unavailable |
| Which connected systems participated? | MCP service and call count | None for observed VS Code calls |
| Are connectors reliable and responsive? | Success/failure and observed duration when start/completion both exist | Some calls lack a start timestamp, so duration can be unavailable |
| Did the workflow produce something useful? | Some local/tool success signals | Add outcome adapters for Epic, BRD, report, deck, or other artifact completion |
| What did WorkIQ or ADO cost individually? | Configured allocation only | Provider billing/metering plus correlation IDs |

This changes the HQ value proposition from **“which MCP tool burned how many
tokens?”** to **“what did an FD&E business workflow cost, which systems did it
depend on, did it complete, and what outcome did it produce?”** That is a more
useful leadership unit even if per-call token chargeback becomes available later.

### What the FD&E HQ profile does

The built-in group is a configuration profile, not a hard product dependency. It:

- recognizes explicit `fde-*` workflows and observed HQ `SKILL.md` loads;
- classifies known Agency/Microsoft MCP identifiers into services such as WorkIQ,
  Azure DevOps, SharePoint, Teams, Fabric, and Kusto;
- associates measured Copilot request cost with matching HQ turns;
- shows connector calls, completion status, and duration;
- permits local allocation rates while leaving unknown costs visibly unpriced;
- can be disabled without affecting core Token Lens capture.

New HQ services can be added through custom groups and settings. They do not
require a Token Lens code fork.

### The important HQ coverage gap

FD&E HQ spans multiple execution surfaces, but Token Lens currently measures only
**VS Code GitHub Copilot Chat**:

| HQ surface | Workflow activity | Authoritative tokens |
| --- | --- | --- |
| VS Code Copilot Chat | Yes | Yes, with explicit input/output coverage when Copilot omits a direction |
| Agency Copilot CLI terminal | Potentially observable with a future adapter | No token/credit fields in the current local store |
| Microsoft Scout | Not captured by Token Lens | Not available through the VS Code data source |
| Direct scripts or service jobs | Only if surfaced as an observed VS Code tool call | Must come from the target service meter |

Therefore, do not label the current dashboard **“total FD&E HQ AI spend.”** Label
it **“measured FD&E HQ workflow spend in VS Code Copilot Chat.”** Combining CLI,
Scout, and service-side consumption requires additional adapters and compatible
metering sources.

### How the FD&E HQ versus Other comparison works

Every VS Code Copilot request is assigned once, using the strongest available
evidence:

1. **FD&E HQ workflow, high confidence:** explicit `fde-*` skill, `@agent`, or
   `/prompt`. The whole surrounding request cost is attributed to that workflow.
2. **FD&E HQ associated, medium confidence:** no explicit workflow marker, but a
   known FD&E-group MCP participated. This is correlation, not proof of origin.
3. **Mixed, low confidence:** tools from several selected groups participated
   without an explicit workflow. No forced split is manufactured.
4. **Other Copilot:** no selected-group signal.

This creates the leadership comparison requested without dividing tokens among
MCP calls. It also avoids double counting: one request, one bucket. Workspace
location alone is never treated as attribution evidence.

Report high and medium confidence separately. If leadership wants one headline,
use **“FD&E-related measured cost envelope” = high + medium**, show both components,
and retain Mixed and Other as separate rows.

The Tools view implements exactly this: a two-number **FD&E HQ related vs Other /
mixed** headline, followed by the explicit/high and associated/medium rows that
make up the FD&E-related side.

Different ways of opening HQ can also create separate VS Code storage scopes. For
the pilot, always open the committed `FDE.code-workspace` and run every demo from
that same window. Do not alternate between the parent `c:\ai\hq` folder and the
multi-root workspace when comparing totals.

### Skill attribution is strong but not universal

Attribution is strongest when the transcript contains an explicit `@fde-*`
agent, `/prompt fde-*`, or observed read of an HQ `SKILL.md`. If the host injects
an instruction or skill without an observable load event, its cost remains in the
request total but may appear under a generic matched workflow. That is another
reason to describe this as correlation rather than exact causal allocation.

### Governance implications

This is compatible with HQ's disclosure-not-surveillance principle if the pilot
stays metadata-only and local:

- no prompt, tool argument, document, email, or financial content is uploaded;
- no people-level leaderboard or individual productivity score;
- team/HQ rollups require explicit approval, retention rules, and aggregation;
- generated financial outputs remain drafts and are not systems of record;
- external service dollars remain `unpriced` unless finance provides a defensible
  allocation or reconciled meter.

The first pilot should report workflow/category totals, never stakeholder content
or user-level rankings.

### Recommended FD&E pilot

Use two contrasting, read-only VS Code Chat workflows:

1. **ADO workflow:** an `fde-ado-hygiene` quick assessment or read-only backlog
   query. Measure matched Copilot cost, ADO calls, completion, and duration.
2. **Cross-M365 workflow:** a constrained `fde-project-intake` context sweep using
   WorkIQ, stopping before any Epic write. Measure matched Copilot cost, WorkIQ
   calls, completion, and duration.

For each, record one outcome manually for the readout: assessment produced,
context gaps identified, or decision-ready artifact completed. Do not use real
financial or stakeholder content in screenshots.

The pilot compares **workflow envelopes**, not individual connector token bills:

```text
workflow → measured Copilot tokens/AICs → observed services/calls → reliability/time → outcome
```

### FD&E-specific leadership decision

The immediate decision is not whether Token Lens can solve exact MCP accounting;
the platform does not expose it. The decision is:

> Is workflow-level cost, reliability, adoption, and outcome visibility valuable
> enough for FD&E HQ to pilot while we separately determine whether exact
> chargeback warrants a Copilot/Agency platform dependency?

If yes, FD&E HQ becomes the first configurable profile and validation environment,
not a one-off hard-coded integration.

## Six-beat presentation

### 1. The gap is real

**Claim:** AI-assisted business workflows have no live cost envelope while the
work is happening.

- Copilot records real request-level input tokens, output tokens, and AICs.
- Business workflows can trigger WorkIQ, Azure DevOps, SharePoint, Fabric,
  Kusto, and other MCP services.
- Today those two views are disconnected.

**Say:** “We can see the AI bill after the fact, and we can see tools run, but we
cannot see the workflow cost envelope live.”

### 2. What Token Lens measures today

**Claim:** The MVP connects measured Copilot spend to observed workflow activity
without uploading business content.

- Real Copilot usage by turn, current chat, workspace, and day.
- Skills, agents, saved prompts, and MCP services associated with a workflow.
- MCP calls, success/failure, and duration.
- Configurable groups, including FD&E HQ, All MCP tools, and future custom
  toolsets.
- Explicit `partial` and `unpriced` states instead of invented values.

**FD&E implication:** HQ becomes a selectable workflow profile. It can compare
the cost envelope and operational behavior of project intake, ADO hygiene, and
other named workflows without changing HQ's skills or MCP configuration.

**Demo callout:** Show the **FD&E HQ vs other** card. Explain that explicit
workflow requests are high confidence, tool-associated requests are medium, and
every turn appears once.

**Say:** “This is measured spend around the workflow, plus observed tool
activity. It is not a fabricated per-tool bill.”

### 3. The boundary we discovered

**Claim:** Exact MCP token allocation is not present in the available telemetry.

| Available | Missing |
| --- | --- |
| Request input/output tokens and AICs | Tokens per MCP call |
| Aggregate Tool Definitions tokens | Definitions by individual server/call |
| Aggregate Tool Results tokens | Results by individual server/call |
| Tool name, success, timestamps | Tool-level token/credit/billing meter |
| Agency call/session duration | Agency CLI token and credit fields |

**Say:** “The limitation is not that we have not found the right formula. The
source record does not contain the allocation key.”

### 4. Why the tool view still matters

**Claim:** Workflow-level observability answers operational questions even
without exact per-call tokens.

- Which workflows consume the most Copilot spend?
- Which services are invoked, slow, failing, or repeatedly retried?
- How much aggregate context is Tool Definitions and Tool Results?
- What is the AI cost per completed intake, BRD, assessment, or artifact?
- Which toolsets are adopted, and which add overhead without producing outcomes?

**FD&E implication:** The useful unit is an intake, hygiene assessment, BRD, or
other business workflow, not a raw MCP function. Add outcome adapters to move
from “cost per turn” toward “cost per completed FD&E outcome.”

**Say:** “We cannot say WorkIQ used exactly 30,000 tokens. We can say this
project-intake workflow used 120,000 measured Copilot tokens, called WorkIQ
twice and ADO once, took N seconds, and produced or failed to produce an Epic.”

### 5. What exact attribution would require

**Claim:** Exactness requires a small, explicit metering contract from the host.

Minimum event shape:

```text
workflowId
copilotRequestId
modelSubturnId
toolCallId
serviceId
inputTokens
outputTokens
cachedTokens
credits or meterId + consumedUnits
```

The same correlation IDs must survive from Copilot to Agency/MCP and, for
invoice reconciliation, into the target service or cost-management record.

**Say:** “A proxy or proportional estimate could manufacture a split, but it
would not be authoritative. The clean solution is provider-emitted usage joined
by correlation ID.”

### 6. Decision and next move

**Decision requested:** Which outcome matters enough to fund?

| Option | Delivers | Cost/risk |
| --- | --- | --- |
| **A. Ship observability MVP** | Workflow cost envelope, calls, reliability, latency, outcomes | Low; available now |
| **B. Add outcome adapters** | Cost per Epic, BRD, report, or artifact | Medium; source-specific joins |
| **C. Pursue exact MCP metering** | Per-call token/chargeback | High dependency on Copilot/Agency/service contracts |
| **D. Stop** | No further investment | Gives up workflow visibility already working |

**Recommended:** A now, validate demand for B, and pursue C only with a named
chargeback requirement and a platform partner.

**FD&E recommendation:** Pilot A inside the committed HQ workspace using VS Code
Chat only. Treat B as the next differentiator. Ask the Copilot/Agency platform
teams about C, but do not block the pilot on it.

## Three-minute demo script

### Before the meeting

1. Install Token Lens 0.7.2 and run **Developer: Reload Window**.
2. Open the actual FD&E HQ workspace.
3. Use **VS Code GitHub Copilot Chat**, not Agency Copilot CLI.
4. Turn on **Token Lens → Tools → Business tools → FD&E HQ**.
5. Run one short, read-only workflow that invokes a known MCP service.
6. Run **Token Lens: Capture self-test**. Require at least one fully metered or
   partial turn before relying on the live demo.
7. Leave external allocation rates empty unless finance supplied a defensible
   rate. `unpriced` is safer than an invented dollar figure.
8. Capture screenshots as backup. Do not depend solely on a live MCP/auth path.

### In the room

1. **Dashboard:** show real workspace/chat/today tokens, AICs, coverage labels,
   and request-level Tool Definitions/Tool Results.
2. **Tools:** show FD&E HQ as an optional group, matched workflow AI cost, MCP
   service calls, success, and duration.
3. Point to the note: **request-level cost, not a per-call token split**.
4. End on the decision table, not on the technical limitation.

### Demo contingency

The current FDE HQ storage audit found six chat-session shells but no transcripts
or token fields. Old or Agency CLI activity will therefore not populate the
view. If a fresh VS Code Copilot Chat workflow does not pass self-test by July
16, use validated screenshots and present the demo as an instrumented prototype,
not a live HQ production reading.

## Exact language to use

### Safe claims

- “Measured Copilot cost for workflows that used MCP tools.”
- “Observed MCP calls, service, success, and duration.”
- “Aggregate tool-definition and tool-result overhead.”
- “Known minimum” when a token direction is unavailable.
- “Configured allocation” for external service dollars.

### Claims to avoid

- “Tokens consumed by WorkIQ.”
- “Exact MCP cost.”
- “Total AI cost across VS Code and Agency CLI.”
- “Actual Azure/Fabric invoice cost” unless reconciled to a billing source.
- Any external dollar figure created only for the demo.

## Likely leadership questions

### Is the tool-tracking feature useless?

No. It measures participation, reliability, latency, adoption, and the Copilot
cost envelope around a workflow. It is insufficient only for exact per-call
token chargeback.

### Why not divide Tool Results proportionally by response size?

That would be an estimate with unknown model serialization, truncation, caching,
and subturn boundaries. It may be useful for experimentation but is not suitable
for leadership reporting or chargeback.

### Why not intercept traffic with a proxy?

It adds security, certificate, privacy, compatibility, and support risk. It also
may not expose internal model subturn accounting. Provider-emitted metering is
the durable route.

### Can Azure Cost Management solve it?

It can provide actual resource cost, usually delayed and aggregated. Exact
workflow allocation still needs a correlation ID carried into the resource or
meter record.

### Is the current Copilot total trustworthy?

Within VS Code Chat scope, Token Lens includes every independently metered token
direction. If Copilot omits input or output for a completed request, the total is
shown as a `partial` known minimum. It does not include Agency CLI usage.

## Evidence from the local audit

This is engineering validation, not an org-wide benchmark:

- 223 Copilot request records inspected without reading business content.
- 202 had full tokens, credits, and category breakdown.
- 7 had full tokens and credits but no category breakdown.
- 14 had completion tokens only.
- Those 14 contained 118,580 known output tokens previously omitted by the
  all-or-nothing aggregate; Token Lens 0.7.2 now includes them and marks the
  total partial.
- Transcript schemas contained zero token/credit/usage fields on tool events.
- Agency CLI session-store schema contained no token or credit columns.

## The leadership ask in one line

**Approve a short workflow-observability pilot, and decide whether exact MCP
chargeback is important enough to require a Copilot/Agency metering partnership.**