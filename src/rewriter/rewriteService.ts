import type { CoachConfig } from '@tokentama/llm-adapters';
import { chatComplete, isCoachConfigured, leanRewrite } from '@tokentama/llm-adapters';
import type { TrainingPair } from '../data/corpusStore';
import { buildRewriteMessages, retrievePairs } from './corpusRetrieval';

export type RewriterMode = 'off' | 'offline' | 'auto' | 'llm';

export interface RewriteConfig {
  mode: RewriterMode;
  fewShotK: number;
  coach: CoachConfig;
}

export interface RewriteResult {
  rewrittenPrompt?: string;
  /** Positive % when the rewrite is shorter; undefined when it adds specificity. */
  estimatedTokenReductionPct?: number;
  /** True when the rewrite is longer because it added specifics to avoid retries. */
  clarified?: boolean;
  source: 'offline' | 'llm' | 'none';
  /** How many corpus examples informed the rewrite. */
  examplesUsed: number;
}

export interface CorpusPairs {
  trainingPairs(): TrainingPair[];
}

/**
 * A single-turn completion (system, user) → text. Injected so the service can use
 * VS Code's Language Model API — the user's own Copilot models, no API key.
 */
export type LlmComplete = (system: string, user: string) => Promise<string>;

/** Strip code fences / surrounding quotes an LLM might wrap the rewrite in. */
export function cleanRewrite(raw: string): string {
  return raw
    .replace(/^```[\w-]*\r?\n?/, '')
    .replace(/\r?\n?```$/, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

/**
 * Automatic prompt rewriter. When asked explicitly it uses a real model to turn a
 * rough/vague ask into a precise, self-contained prompt that gets the SAME result
 * with fewer total tokens — adding the minimal specifics needed to avoid retries,
 * or cutting filler when the prompt is padded.
 *
 * Backends, in order: the injected VS Code Language Model (your own Copilot models,
 * no key), then an external provider if configured, then the offline cleaning
 * rewrite. An explicitly-requested rewrite is always shown.
 */
export class RewriteService {
  constructor(
    private readonly corpus: CorpusPairs,
    private readonly getConfig: () => Promise<RewriteConfig>,
    private readonly llmComplete?: LlmComplete,
  ) {}

  async rewrite(input: { promptText: string; model?: string }): Promise<RewriteResult> {
    const prompt = input.promptText;
    if (!prompt.trim()) return { source: 'none', examplesUsed: 0 };

    const cfg = await this.getConfig();
    if (cfg.mode === 'off') return { source: 'none', examplesUsed: 0 };

    const examples = retrievePairs(this.corpus.trainingPairs(), prompt, {
      k: cfg.fewShotK,
      model: input.model,
    });

    if (cfg.mode === 'llm' || cfg.mode === 'auto') {
      const raw = await this.tryLlm(prompt, examples, cfg);
      if (raw) {
        const result = this.present(prompt, cleanRewrite(raw), 'llm', examples.length);
        if (result.rewrittenPrompt) return result;
      }
    }

    return this.present(prompt, leanRewrite(prompt), 'offline', examples.length);
  }

  /** Try the best available model backend; returns raw text or undefined. */
  private async tryLlm(
    prompt: string,
    examples: TrainingPair[],
    cfg: RewriteConfig,
  ): Promise<string | undefined> {
    const { system, user } = buildRewriteMessages(prompt, examples);
    // Prefer the user's own Copilot models via the injected LM (no key required).
    if (this.llmComplete) {
      try {
        const out = await this.llmComplete(system, user);
        if (out && out.trim()) return out;
      } catch {
        /* try the next backend */
      }
    }
    // Fall back to an explicitly configured external provider, if any.
    if (isCoachConfigured(cfg.coach)) {
      try {
        const maxTokens = Math.min(500, Math.ceil(prompt.length / 3) + 120);
        return await chatComplete(cfg.coach, system, user, { temperature: 0.3, maxTokens });
      } catch {
        /* fall through to offline */
      }
    }
    return undefined;
  }

  /**
   * Present a produced rewrite. Since the user asked for it explicitly, always show
   * a real, different rewrite — reporting % saved when shorter, or marking it
   * "clarified" (added specifics to succeed first try) when it's longer.
   */
  private present(
    original: string,
    rewrite: string | undefined,
    source: 'offline' | 'llm',
    examplesUsed: number,
  ): RewriteResult {
    const o = original.trim();
    const r = rewrite?.trim();
    if (!r || r === o) return { source: 'none', examplesUsed };
    const shorter = r.length < o.length;
    return {
      rewrittenPrompt: r,
      estimatedTokenReductionPct: shorter ? Math.round((1 - r.length / o.length) * 100) : undefined,
      clarified: !shorter,
      source,
      examplesUsed,
    };
  }
}
