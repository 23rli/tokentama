# Business-tool cost attribution

Token Lens can correlate GitHub Copilot spend with the skills, agents, saved
prompts, and MCP-backed business services used during the same turn. Business
tracking is an **optional layer** over core Copilot cost tracking. It is off by
default and organized as independently selectable groups.

The model is vendor-neutral. FD&E HQ is one built-in group rather than a hard
dependency; other groups can be added through settings without changing Token
Lens code.

## Enable tracking and choose groups

Open **Token Lens → Tools**:

1. Turn **Business tools** on. This does not change core Copilot capture.
2. Enable one or more groups:
   - **FD&E HQ** classifies the Agency-backed M365, ADO, Fabric, security, and
     utility services plus explicit `fde-*` workflows.
   - **All MCP tools** is a generic fallback for every MCP server, including
     tools Token Lens does not recognize.
   - Any group added under `tokenlens.businessTools.customGroups` appears in
     the same list and can be switched independently.

Settings are workspace-scoped when a folder or workspace is open. Turning a
group on reclassifies the existing local chat history in scope; Token Lens does
not create a second activity log. Turning it off removes that group's
attribution from the view.

## What is tracked

| Signal | Source | Confidence |
| --- | --- | --- |
| Copilot input/output tokens and AICs | Copilot's local chat session files | Metered |
| Tool name, completion status, and runtime | Copilot's local transcript | Observed |
| Business service | MCP tool identifier, such as `mcp_workiq_*` | Classified |
| Skill | A completed tool call that loads `skills/<name>/SKILL.md` | Observed |
| Agent or saved prompt | An explicit leading `@agent` or `/prompt name` | Observed |
| External tool cost | A local rate configured by the user | Estimated |

Raw tool arguments are never placed in Token Lens state. The parser inspects
arguments only long enough to reduce a skill path to its normalized skill name.
Prompt and response content remain subject to the same local, read-only privacy
boundary as the rest of Token Lens. Nothing is uploaded.

### Token attribution boundary

MCP does not define a standard token-usage field. VS Code transcripts record
that a tool ran, its timing, and whether it succeeded, but contain no tokens or
credits on the tool event. Copilot writes metering on the surrounding user
request instead:

- `promptTokens` and `completionTokens` provide the request total;
- `Tool Definitions` is the aggregate cost of tool schemas exposed to the model;
- `Tool Results` is the aggregate cost of returned tool content;
- neither category identifies WorkIQ vs. ADO vs. another individual call.

Token Lens can therefore measure **Copilot cost for a workflow containing MCP
calls**, but cannot truthfully claim exact tokens per MCP invocation. Incomplete
token or Copilot-cost values are explicitly labelled **measured** or **known**.

Agency Copilot CLI is also a separate runtime. Its current local session-store
schema and Agency telemetry expose activity but no token/credit fields, so CLI
sessions cannot be added to authoritative token totals yet.

## FD&E HQ example

A project-intake turn might load `fde-project-intake`, call WorkIQ for source
context, and call Azure DevOps to find or create an Epic. Token Lens presents:

1. The metered Copilot cost for the turn.
2. `fde-project-intake` as the workflow.
3. WorkIQ and Azure DevOps call counts, success, and observed runtime.
4. External marginal cost only where a local rate has been supplied.
5. A **known** total when one or more calls remain unpriced.

The built-in FD&E group covers SharePoint, Teams, Outlook, Planner, OneDrive,
Kusto, Fabric / Power BI, ICM, ServiceTree, Microsoft Learn, Playwright, and
MarkItDown. Enable **All MCP tools** for unknown servers, or define a custom
group for another organization's named toolset and workflows.

### FD&E HQ interpretation

For leadership and pilot reporting, describe this as **measured FD&E HQ workflow
spend in VS Code Copilot Chat**, not total HQ spend and not exact MCP cost.

- **Included:** matched VS Code Chat turns, observed HQ skills/agents/prompts,
  participating MCP services, call status, and duration when available.
- **Not included:** Agency Copilot CLI token usage, Microsoft Scout usage, direct
  service jobs, or exact tokens per MCP invocation.
- **Best evaluation unit:** cost envelope and reliability per completed intake,
  hygiene assessment, BRD, report, or other FD&E outcome.
- **Pilot workspace:** consistently use `FDE.code-workspace`; opening the HQ
  parent folder separately creates a different VS Code storage scope.
- **Governance:** keep reporting metadata-only and aggregate. Do not create
  people-level rankings or upload prompt/tool content.

The FD&E HQ group is only a built-in profile. It can be disabled independently,
and future HQ/toolset profiles can be added through custom settings without a
Token Lens fork.

### FD&E HQ versus Other attribution

Token Lens works around the missing per-MCP token split by assigning each whole
Copilot request to exactly one evidence bucket:

| Bucket | Evidence | Confidence | Leadership interpretation |
| --- | --- | --- | --- |
| **FD&E HQ workflow** | Explicit `fde-*` skill load, `@agent`, or `/prompt` | High | Directly attributed workflow request |
| **FD&E HQ associated** | No explicit workflow, but a known FD&E-group MCP participated | Medium | FD&E tool-associated, not proof the workflow originated in HQ |
| **Mixed selected groups** | MCP calls from more than one selected group and no explicit workflow | Low | Keep separate; do not force an allocation |
| **Other Copilot** | No selected-group workflow or tool signal | Unattributed | Comparison baseline |

An explicit workflow wins over tool association. Merely opening the FD&E HQ
workspace does **not** classify every turn as FD&E. This prevents ordinary
Copilot work in the same window from inflating the HQ number.

The UI reports each bucket's whole-request tokens/cost, turn count, MCP calls,
share of known measured spend, and confidence. The buckets are mutually
exclusive, so their turn and token totals do not double count.

Completeness follows the configured cost basis. With a token rate, a missing
token direction makes cost a known minimum. With a credit rate, real metered
AICs provide a complete cost even if the separately displayed token total is
partial; estimated AICs keep the cost marked partial.

For leadership, keep **high-confidence FD&E workflow** separate from
**medium-confidence FD&E associated**. They may be summed as an explicitly
labelled “FD&E-related cost envelope,” but the medium bucket must not be
presented as direct HQ causation.

The card therefore leads with **FD&E HQ related vs Other / mixed**, then shows
the high- and medium-confidence FD&E components separately immediately below.

## Add a custom group

Select **Add or edit groups** and add an object to
`tokenlens.businessTools.customGroups`. Matching is case-insensitive substring
matching against transcript tool identifiers and explicit workflow names.
User-supplied regular expressions are never executed.
Empty or malformed groups are ignored. Each service or workflow list accepts at
most 100 non-empty match strings of at most 100 characters each.

```jsonc
{
  "tokenlens.businessTools.customGroups": {
    "finance-suite": {
      "name": "Finance Suite",
      "description": "Ledger and close-cycle workflows.",
      "mcpOnly": true,
      "workflows": ["close-cycle", "variance-review"],
      "services": {
        "ledger": {
          "name": "Finance Ledger",
          "match": ["contoso_ledger", "ledger_lookup"]
        },
        "warehouse": {
          "name": "Finance Warehouse",
          "match": ["finance_warehouse"]
        }
      }
    }
  },
  "tokenlens.businessTools.enabledGroups": ["finance-suite"]
}
```

Custom groups take precedence over named built-ins. The **All MCP tools** group
is always the final fallback, so a call is counted once even when several
enabled groups could match it.

## Configure marginal rates

Open **Token Lens → Tools → Set rates**, then edit
`tokenlens.businessTools.rates`. Keys can be a normalized service ID, an exact
transcript tool name, a group/service pair, or an entire group.

```jsonc
{
  "tokenlens.businessTools.rates": {
    // Included in an existing license: known marginal cost of zero.
    "workiq": 0,
    "azure-devops": { "usdPerCall": 0 },

    // Disambiguate duplicate service IDs or price an entire custom group.
    "finance-suite/ledger": { "usdPerCall": 0.02 },
    "group:finance-suite": { "usdPerCall": 0.005 },

    // Example internal allocation, not a Token Lens pricing claim.
    "kusto": { "usdPerCall": 0.01, "usdPerMinute": 0.05 },

    // Optional fallback for every otherwise unmatched MCP service.
    "*": { "usdPerCall": 0.002 }
  }
}
```

Supported canonical IDs include:

- `azure-devops`, `workiq`, `sharepoint`, `sharepoint-lists`
- `outlook-mail`, `calendar`, `teams`, `planner`, `word`, `onedrive`
- `fabric`, `kusto`, `icm`, `enghub`, `bluebird`
- `mrc`, `s360`, `security`, `service-tree`, `microsoft-learn`
- `playwright`, `markitdown`

A numeric value is shorthand for `usdPerCall`. An object can define
`usdPerCall`, `usdPerMinute`, or both. Rate precedence is exact tool name,
`group/service`, service ID, `group:<id>`, then `*`. No default external rate is
assumed.

## What “direct spend” means

Copilot token and AIC usage is directly metered from Copilot's local records.
The transcript directly proves that a business tool ran, whether it succeeded,
and how long the call took. It does **not** contain the service's own bill.

That distinction matters:

- Many Microsoft 365 and internal services are license-included, so a call has
  no separate invoice line.
- Azure consumption can be billed by resource, capacity, query volume, or time;
  an MCP invocation alone is not a billing unit.
- A skill can run local scripts that call a cloud service outside MCP; Token
  Lens sees the local tool call but cannot infer the downstream bill.
- A configured rate is a transparent allocation assumption, not actual billing.

For invoice-grade spend, add billing adapters rather than guessing:

1. **Azure Cost Management** for subscription/resource-level actuals.
2. **Fabric capacity metrics** for capacity allocation.
3. **M365 license allocation** for fixed-cost tools.
4. **Agency or service-side metering** if a connector later emits charge units
   or correlation IDs.

Those sources can feed the same activity model, but reliable per-workflow
allocation requires a correlation ID or tagging contract at the service call.

## Evaluating a business tool

Cost is only one side of the decision. Use the Tools view to establish the
denominator, then pair it with an outcome source:

- cost per completed intake, BRD, board assessment, or artifact;
- success and retry rate by service;
- elapsed tool time and human time saved;
- cost per work item created or decision delivered;
- adoption by workflow, team, or HQ, aggregated without prompt content.

Token Lens currently supplies the local activity and cost denominator. Outcome
connectors are a follow-up because Copilot's transcript does not prove that a
work item, report, or decision produced business value.