# Deploying the Tokentama API to Azure

The API runs **fully locally** with no Azure resources (plain Node server + in-memory
store). This guide is for a real cloud deployment.

## What gets provisioned

`infra/bicep/main.bicep` creates:

- **Storage account** + a `scores` table (durable score history)
- **Log Analytics workspace** + **Application Insights** (telemetry)
- **Consumption Function App** (Node 20, Functions v4) running the API
- _Optional_ **Azure OpenAI** account + model deployment (`deployAzureOpenAI=true`)

## 1. Provision

```bash
az group create -n eco-prompt-guardians -l eastus

az deployment group create \
  -g eco-prompt-guardians \
  -f infra/bicep/main.bicep \
  -p infra/bicep/main.parameters.json
```

Outputs include `functionAppName`, `functionAppHostname`, and (if enabled)
`openAiEndpoint`.

## 2. Configure LLM coaching (optional)

If you deployed Azure OpenAI (or use your own endpoint), set these on the Function App:

```bash
az functionapp config appsettings set -g eco-prompt-guardians -n <functionAppName> --settings \
  ECO_LLM_PROVIDER=azure-openai \
  ECO_LLM_ENDPOINT=https://<your-openai>.openai.azure.com \
  ECO_LLM_DEPLOYMENT=gpt-4o-mini \
  ECO_LLM_API_KEY=<key>
```

Without these, the API serves the deterministic **heuristic coach** (tips + rewrites).

## 3. Deploy the code

The functions live in `apps/api` (Functions v4 programming model). Build first:

```bash
npm run build
```

Then deploy with the Azure Functions Core Tools (run from `apps/api`):

```bash
cd apps/api
func azure functionapp publish <functionAppName>
```

The Bicep already wires `ECO_STORAGE_CONNECTION_STRING`,
`APPLICATIONINSIGHTS_CONNECTION_STRING`, and `FUNCTIONS_WORKER_RUNTIME=node`, so the
API will use Table Storage + App Insights automatically once deployed.

## 4. Point the widget at the cloud API

```powershell
$env:ECO_API_URL = 'https://<functionAppHostname>/api'
npm run widget:dev
```

> Function endpoints `scorePrompt`, `generateTip`, and `sessionSummary` use
> `authLevel: 'function'`; `health` is anonymous. For a hosted demo you can pass the
> function key via the API URL or relax the auth level.
