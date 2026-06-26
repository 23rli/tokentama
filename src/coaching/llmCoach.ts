import type { TipRequest, TipResponse } from '@tokentama/shared-types';
import type { CoachConfig } from './config';
import { COACH_SYSTEM_PROMPT, buildCoachUserMessage } from './promptTemplates';

interface ChatEndpoint {
  url: string;
  headers: Record<string, string>;
  model?: string;
}

function resolveEndpoint(config: CoachConfig): ChatEndpoint {
  const endpoint = (config.endpoint ?? '').replace(/\/+$/, '');
  switch (config.provider) {
    case 'azure-openai':
      return {
        url: `${endpoint}/openai/deployments/${config.deployment}/chat/completions?api-version=${config.apiVersion}`,
        headers: { 'content-type': 'application/json', 'api-key': config.apiKey ?? '' },
      };
    case 'foundry':
      return {
        url: endpoint.includes('/chat/completions')
          ? endpoint
          : `${endpoint}/chat/completions?api-version=${config.apiVersion}`,
        headers: { 'content-type': 'application/json', 'api-key': config.apiKey ?? '' },
        model: config.deployment,
      };
    case 'openai':
    default:
      return {
        url: endpoint
          ? `${endpoint}/chat/completions`
          : 'https://api.openai.com/v1/chat/completions',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey ?? ''}`,
        },
        model: config.deployment ?? 'gpt-4o-mini',
      };
  }
}

async function callChatCompletion(
  config: CoachConfig,
  system: string,
  user: string,
): Promise<string> {
  const { url, headers, model } = resolveEndpoint(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        ...(model ? { model } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.4,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) {
      throw new Error(`Coach LLM HTTP ${response.status}`);
    }
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timeout);
  }
}

function parseCoachJson(content: string): Omit<TipResponse, 'source'> {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON in coach response');
  const obj = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;

  const tokenPct = Number(obj.estimatedTokenReductionPct);
  const latencyPct = Number(obj.estimatedLatencyReductionPct);
  const rewritten = obj.rewrittenPrompt;

  return {
    shortTip: String(obj.shortTip ?? 'Here’s a more efficient version.'),
    detailedTip: String(obj.detailedTip ?? ''),
    rewrittenPrompt:
      typeof rewritten === 'string' && rewritten.trim().length > 0 ? rewritten : undefined,
    estimatedSavings: {
      estimatedTokenReductionPct: Number.isFinite(tokenPct) ? tokenPct : undefined,
      estimatedLatencyReductionPct: Number.isFinite(latencyPct) ? latencyPct : undefined,
    },
  };
}

/** Generate a tip via a live LLM. Throws on any failure so callers can fall back. */
export async function llmGenerateTip(req: TipRequest, config: CoachConfig): Promise<TipResponse> {
  const content = await callChatCompletion(config, COACH_SYSTEM_PROMPT, buildCoachUserMessage(req));
  return { ...parseCoachJson(content), source: config.provider };
}
