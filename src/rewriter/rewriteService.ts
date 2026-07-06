import type { CoachConfig } from '@tokentama/llm-adapters';
import { chatComplete, isCoachConfigured, leanRewrite } from '@tokentama/llm-adapters';
import { estimateTokens } from '@tokentama/scoring-engine';
import type { TrainingPair } from '../data/corpusStore';
import { buildRewriteMessages, retrievePairs } from './corpusRetrieval';

/** Below this length, a specific prompt doesn't justify spending an LLM call. */
const MIN_LLM_CHARS = 80;

export type RewriterMode = 'off' | 'offline' | 'auto' | 'llm';

export interface RewriteConfig {
  mode: RewriterMode;
  fewShotK: number;
  coach: CoachConfig;
}

export interface RewriteResult {
  rewrittenPrompt?: string;
  /** Positive % of tokens saved when the rewrite happens to be shorter; else undefined. */
  estimatedTokenReductionPct?: number;
  /** Estimated tokens saved when the rewrite is shorter than the original; else undefined. */
  estimatedTokensSaved?: number;
  source: 'offline' | 'llm' | 'none';
  /** How many corpus examples informed the rewrite. */
  examplesUsed: number;
  /** Estimated tokens THIS rewrite call itself spent (0 for offline) — for net accounting. */
  llmTokensSpent?: number;
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
    private readonly getPortfolio?: () => string | undefined,
    private readonly log?: (message: string) => void,
  ) {}

  async rewrite(input: {
    promptText: string;
    model?: string;
    /** User clicked “Rewrite in my style” — always use the model, skip the cost gate. */
    explicit?: boolean;
    /** Recent session context (files/targets and last asks) to resolve references. */
    recentContext?: string;
    /** When false, never spend a model call (over budget / unlikely to help) — offline only. */
    allowModel?: boolean;
  }): Promise<RewriteResult> {
    const prompt = input.promptText;
    if (!prompt.trim()) return { source: 'none', examplesUsed: 0 };

    const cfg = await this.getConfig();
    if (cfg.mode === 'off') return { source: 'none', examplesUsed: 0 };

    const examples = retrievePairs(this.corpus.trainingPairs(), prompt, {
      k: cfg.fewShotK,
      model: input.model,
    });

    const wantModel = cfg.mode === 'llm' || (cfg.mode === 'auto' && this.worthLlm(prompt));
    const useLlm = input.explicit || (input.allowModel !== false && wantModel);
    if (useLlm) {
      const llm = await this.tryLlm(prompt, examples, cfg, input.recentContext);
      if (llm) {
        // Surface the model's improved prompt as-is — it fixes the ask, whether or
        // not that makes it shorter. (We report token savings only when it is.)
        const result = this.present(prompt, cleanRewrite(llm.raw), 'llm', examples.length);
        result.llmTokensSpent = llm.tokensSpent;
        return result;
      }
      this.log?.('Rewrite: no model backend available — using the offline cleanup.');
    }

    // Offline fallback is cleanup-only, so only surface it when it genuinely
    // shortens the prompt (a bare capitalization tweak isn't worth showing).
    const off = leanRewrite(prompt);
    if (off.trim().length < prompt.trim().length) {
      return this.present(prompt, off, 'offline', examples.length);
    }
    return { source: 'none', examplesUsed: examples.length };
  }

  /**
   * Cost gate for automatic (non-explicit) `auto` rewrites: only spend a model call
   * when the prompt has enough substance to improve. An explicit “Rewrite in my
   * style” click bypasses this — that's a direct request for the model.
   */
  private worthLlm(prompt: string): boolean {
    return prompt.trim().length >= MIN_LLM_CHARS;
  }

  /** Try the best available model backend; returns raw text + its estimated token spend. */
  private async tryLlm(
    prompt: string,
    examples: TrainingPair[],
    cfg: RewriteConfig,
    recentContext?: string,
  ): Promise<{ raw: string; tokensSpent: number } | undefined> {
    const { system, user } = buildRewriteMessages(prompt, examples, this.getPortfolio?.(), recentContext);
    const spend = (out: string): number =>
      estimateTokens(system) + estimateTokens(user) + estimateTokens(out);
    // Prefer the user's own Copilot models via the injected LM (no key required).
    if (this.llmComplete) {
      try {
        this.log?.('Rewrite: asking your Copilot model…');
        const out = await this.llmComplete(system, user);
        if (out && out.trim()) {
          this.log?.('Rewrite: Copilot model responded.');
          return { raw: out, tokensSpent: spend(out) };
        }
        this.log?.('Rewrite: Copilot model returned nothing — trying the next backend.');
      } catch (e) {
        this.log?.(`Rewrite: Copilot model unavailable (${(e as Error).message}).`);
      }
    }
    // Fall back to an explicitly configured external provider, if any.
    if (isCoachConfigured(cfg.coach)) {
      try {
        this.log?.('Rewrite: asking the configured provider…');
        const maxTokens = Math.min(500, Math.ceil(prompt.length / 3) + 120);
        const out = await chatComplete(cfg.coach, system, user, { temperature: 0.3, maxTokens });
        return { raw: out, tokensSpent: spend(out) };
      } catch (e) {
        this.log?.(`Rewrite: provider failed (${(e as Error).message}).`);
      }
    }
    return undefined;
  }

  /**
   * Present a produced rewrite. The rewrite's job is to FIX the prompt so it lands
   * the right result — it may be shorter, the same length, or longer. We surface any
   * genuinely different rewrite and report token savings only when it is shorter.
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
    const before = estimateTokens(o);
    const after = estimateTokens(r);
    const saved = before - after;
    return {
      rewrittenPrompt: r,
      estimatedTokenReductionPct: saved > 0 ? Math.round((saved / before) * 100) : undefined,
      estimatedTokensSaved: saved > 0 ? saved : undefined,
      source,
      examplesUsed,
    };
  }
}
