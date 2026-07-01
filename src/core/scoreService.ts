import type { PromptEvent, ScorePromptRequest } from '@tokentama/shared-types';
import {
  dominantWasteCategories,
  scorePrompt,
  clampScore,
  estimateTokenUsage,
} from '@tokentama/scoring-engine';
import { generateTip, heuristicGenerateTip, leanRewrite, type CoachConfig } from '@tokentama/llm-adapters';
import { SessionTracker, buildPromptEvent } from '../capture/parsers';
import type { TamaStore } from '../state/tamaStore';
import type { ComposeResult, TipView } from '../webview/contract';
import type { ScoreTelemetry } from '../telemetry/telemetryService';
import type { CorpusRecord, CorpusSink } from '../data/corpusStore';
import { predictRetryRisk, similarRetryStats } from '../analysis/retryRisk';
import { deriveInsights, hasTarget, type CorpusInsights } from '../analysis/corpusInsights';

const MANUAL_SESSION = 'manual-session';

const DEMO_SESSION = 'tokentama-demo';
const DEMO_STEP_MS = 1200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DemoStep {
  /** Target headline score — guarantees the Clippy state shown for this step. */
  score: number;
  promptText: string;
  recentPrompts?: string[];
  responseText?: string;
  adoptedPreviousTip?: boolean;
  inputTokens: number;
  outputTokens: number;
}

const DEMO_PRIOR = 'Fix the OAuth login in src/auth/login.ts so token refresh works on timeout.';

/** A guided tour from a pristine prompt down to a catastrophic one, then recovery. */
const DEMO_STEPS: DemoStep[] = [
  {
    score: 95,
    promptText:
      'Summarize src/auth/login.ts in 5 bullets: the top risk, the exact fix, and one test to add.',
    inputTokens: 1900,
    outputTokens: 380,
  },
  {
    score: 76,
    promptText:
      'Refactor the validateEmail function in utils.ts to use one regex and return a typed Result.',
    inputTokens: 2600,
    outputTokens: 720,
  },
  {
    score: 52,
    promptText: 'Improve the error handling in the API layer and make it more robust.',
    inputTokens: 3200,
    outputTokens: 1100,
  },
  {
    score: 33,
    promptText:
      'Could you please, if it is not too much trouble, kindly help me make the thing work ' +
      'better — you know what i mean, the usual stuff.',
    responseText: 'detail '.repeat(900),
    inputTokens: 900,
    outputTokens: 1800,
  },
  {
    score: 14,
    promptText: 'Fix it. Still not working. Try again, just fix it.',
    recentPrompts: [DEMO_PRIOR, 'Fix it.'],
    responseText: 'detail '.repeat(700),
    inputTokens: 800,
    outputTokens: 1500,
  },
  {
    score: 0,
    promptText:
      `${DEMO_PRIOR} ${DEMO_PRIOR} Still not working, try again, just fix it, do this. ` +
      `${DEMO_PRIOR} ${DEMO_PRIOR}`,
    recentPrompts: [DEMO_PRIOR, `${DEMO_PRIOR} ${DEMO_PRIOR}`],
    responseText: 'detail '.repeat(3000),
    adoptedPreviousTip: false,
    inputTokens: 38000,
    outputTokens: 4200,
  },
  {
    score: 92,
    promptText:
      'Add a unit test for parseEmail covering empty, valid, and malformed input — ' +
      'one test function, no prose.',
    inputTokens: 1500,
    outputTokens: 480,
  },
];

/**
 * Orchestrates the score → coach → persist pipeline for both the manual command
 * and the passive Copilot watcher. Keeps a per-session SessionTracker so the
 * detectors get rolling context (recent prompts + retry counts).
 */
export class ScoreService {
  private readonly trackers = new Map<string, SessionTracker>();
  private readonly ingestTrackers = new Map<string, SessionTracker>();
  private manualTurn = 0;
  private demoRunning = false;
  private insightsCache?: { size: number; insights: CorpusInsights };

  constructor(
    private readonly store: TamaStore,
    private readonly getCoachConfig: () => Promise<CoachConfig>,
    private readonly log?: (message: string) => void,
    private readonly telemetry?: ScoreTelemetry,
    private readonly corpus?: CorpusSink,
    private readonly corpusReader?: () => CorpusRecord[],
  ) {}

  private tracker(sessionId: string): SessionTracker {
    let t = this.trackers.get(sessionId);
    if (!t) {
      t = new SessionTracker();
      this.trackers.set(sessionId, t);
    }
    return t;
  }

  private ingestTracker(sessionId: string): SessionTracker {
    let t = this.ingestTrackers.get(sessionId);
    if (!t) {
      t = new SessionTracker();
      this.ingestTrackers.set(sessionId, t);
    }
    return t;
  }

  /** Cached corpus insights (frequent targets), recomputed only when it grows. */
  private insights(): CorpusInsights {
    const records = this.corpusReader?.() ?? [];
    if (!this.insightsCache || this.insightsCache.size !== records.length) {
      this.insightsCache = { size: records.length, insights: deriveInsights(records) };
    }
    return this.insightsCache.insights;
  }

  /** Score arbitrary text typed/pasted/selected by the user. */
  async scoreManualText(text: string): Promise<number> {
    const event = buildPromptEvent({
      source: 'manual',
      sessionId: MANUAL_SESSION,
      userId: 'local',
      turnIndex: this.manualTurn++,
      promptText: text,
    });
    return this.scoreEvent(event, 'manual');
  }

  /** Score a captured Copilot turn. Returns the overall score. */
  async scoreEvent(
    event: PromptEvent,
    source: 'manual' | 'copilot',
    opts: { preliminary?: boolean } = {},
  ): Promise<number> {
    const preliminary = opts.preliminary === true;
    const request = this.tracker(event.sessionId).toScoreRequest(event, { record: !preliminary });
    const previousScore = this.store.latestOverall(event.sessionId);
    const resp = scorePrompt(request, { previousScore: previousScore ?? undefined });

    // Skip coaching on the preliminary pass — the response may still be streaming,
    // and the finalized pass will produce the authoritative tip.
    const tip = preliminary ? undefined : await this.maybeCoach(event, resp);
    const recordOpts = {
      sessionId: event.sessionId,
      source,
      promptText: event.promptText,
      tip,
      tokens: event.tokens,
      model: event.model,
    };
    if (preliminary) this.store.previewScore(resp, recordOpts);
    else this.store.recordScore(resp, recordOpts);
    if (!preliminary) {
      this.reportTelemetry(event, request, resp, tip, source);
      this.recordToCorpus(
        event,
        request,
        resp,
        tip?.rewrittenPrompt,
        tip?.estimatedTokenReductionPct,
        source,
        event.adoptedPreviousTip,
      );
    }
    this.log?.(
      `${preliminary ? 'preview' : 'scored'} (${source}): overall ${Math.round(
        resp.overallScore,
      )} · waste ${Math.round(resp.wasteScore)}`,
    );
    return resp.overallScore;
  }

  /**
   * Score an in-progress DRAFT for the compose box. Offline heuristic only (fast,
   * deterministic, no network) and pure: it never touches session state, health,
   * or the store — so live keystroke scoring can't chip the pet.
   */
  scoreDraft(text: string): ComposeResult {
    const req: ScorePromptRequest = {
      sessionId: 'compose',
      userId: 'local',
      promptText: text,
      metadata: { promptLengthChars: text.length },
    };
    const resp = scorePrompt(req);
    const tokens = estimateTokenUsage(req);
    const categories = dominantWasteCategories(resp);
    let tip: string | undefined;
    let rewrittenPrompt: string | undefined;
    let estimatedTokenReductionPct: number | undefined;
    if (text.trim() && !(resp.overallScore >= 85 && categories.length === 0)) {
      const t = heuristicGenerateTip({
        promptText: text,
        reasons: resp.reasons,
        improvements: resp.improvements,
        wasteCategories: categories,
        overallScore: resp.overallScore,
      });
      tip = t.shortTip;
      // Live suggestion = the pure lean rewrite (genuinely shorter, honest %). The
      // fuller, corpus/LLM rewrite is produced by the explicit "Rewrite in my style".
      const trimmed = text.trim();
      const lean = leanRewrite(text);
      if (lean !== trimmed && lean.length < trimmed.length) {
        rewrittenPrompt = lean;
        estimatedTokenReductionPct = Math.round((1 - lean.length / trimmed.length) * 100);
      }
    }

    // Retry risk: a re-ask re-sends the whole turn, so this is the costliest miss.
    const model = this.store.currentModel()?.family;
    const prior = this.corpusReader
      ? similarRetryStats(this.corpusReader(), categories, model)
      : undefined;
    const retry = predictRetryRisk(resp, { priorAvgRetries: prior?.avgRetries });

    // Context-gap fill (offline, zero tokens): if the prompt names no target but
    // the corpus shows where the user usually works, nudge them to add it.
    let contextGapHint: string | undefined;
    if (text.trim() && !hasTarget(text)) {
      const targets = this.insights().topTargets;
      if (targets.length > 0) {
        contextGapHint = `No file named — you often work in ${targets
          .slice(0, 2)
          .join(', ')}. Naming the target avoids a back-and-forth.`;
      }
    }

    return {
      text,
      overallScore: resp.overallScore,
      wasteScore: resp.wasteScore,
      tip,
      rewrittenPrompt,
      estimatedTokenReductionPct,
      inputTokens: tokens.inputTokens,
      retryRisk: retry.level,
      retryReasons: retry.reasons,
      contextGapHint,
    };
  }

  /** Reset per-run ingest state before a bulk history ingestion. */
  beginIngest(): void {
    this.ingestTrackers.clear();
  }

  /**
   * Bulk-ingest a historical Copilot turn into the corpus: score offline, derive
   * the heuristic lean rewrite (the training target), and record it — WITHOUT
   * touching the pet, store, or telemetry. Feed a session's turns in order so
   * retry/redundancy context builds correctly.
   */
  ingestToCorpus(event: PromptEvent): void {
    if (!this.corpus) return;
    const request = this.ingestTracker(event.sessionId).toScoreRequest(event, { record: true });
    const resp = scorePrompt(request);
    const categories = dominantWasteCategories(resp);
    let rewrittenPrompt: string | undefined;
    let estimatedTokenReductionPct: number | undefined;
    if (event.promptText.trim() && !(resp.overallScore >= 85 && categories.length === 0)) {
      const t = heuristicGenerateTip({
        promptText: event.promptText,
        reasons: resp.reasons,
        improvements: resp.improvements,
        wasteCategories: categories,
        overallScore: resp.overallScore,
      });
      rewrittenPrompt = t.rewrittenPrompt;
      estimatedTokenReductionPct = t.estimatedSavings?.estimatedTokenReductionPct;
    }
    this.recordToCorpus(
      event,
      request,
      resp,
      rewrittenPrompt,
      estimatedTokenReductionPct,
      'copilot',
      event.adoptedPreviousTip,
    );
  }

  /** Append a scored turn (with its lean rewrite) to the local training corpus. */
  private recordToCorpus(
    event: PromptEvent,
    request: ScorePromptRequest,
    resp: ReturnType<typeof scorePrompt>,
    rewrittenPrompt: string | undefined,
    estimatedTokenReductionPct: number | undefined,
    source: string,
    adopted?: boolean,
  ): void {
    if (!this.corpus) return;
    const tokens = event.tokens ?? resp.tokens;
    this.corpus.record({
      sessionId: event.sessionId,
      turnIndex: event.turnIndex,
      source,
      promptText: event.promptText,
      model: event.model?.family,
      reasoningEffort: event.model?.reasoningEffort,
      overallScore: resp.overallScore,
      wasteScore: resp.wasteScore,
      wasteCategories: resp.wasteBreakdown
        .filter((c) => c.severity > 0.05)
        .map((c) => c.category),
      inputTokens: tokens?.inputTokens ?? 0,
      outputTokens: tokens?.outputTokens ?? 0,
      tokensReal: tokens ? !tokens.estimated : false,
      retryCount: request.metadata?.retryCountInSession ?? 0,
      rewrittenPrompt,
      estimatedTokenReductionPct,
      adopted,
    });
  }

  /** Emit local-first pilot telemetry for a finalized score. No-op if disabled. */
  private reportTelemetry(
    event: PromptEvent,
    request: ScorePromptRequest,
    resp: ReturnType<typeof scorePrompt>,
    tip: TipView | undefined,
    source: 'manual' | 'copilot',
  ): void {
    if (!this.telemetry) return;
    const tokens = event.tokens ?? resp.tokens;
    this.telemetry.promptScored({
      sessionId: event.sessionId,
      source,
      promptText: event.promptText,
      overallScore: resp.overallScore,
      wasteScore: resp.wasteScore,
      inputTokens: tokens?.inputTokens ?? 0,
      outputTokens: tokens?.outputTokens ?? 0,
      estimatedCostUsd: tokens?.estimatedCostUsd ?? 0,
      retryCount: request.metadata?.retryCountInSession,
      dominantCategory: dominantWasteCategories(resp)[0],
      model: event.model?.family,
      reasoningEffort: event.model?.reasoningEffort,
      preliminary: false,
    });
    if (tip?.rewrittenPrompt) {
      this.telemetry.suggestionShown({
        sessionId: event.sessionId,
        source,
        promptText: event.promptText,
        category: tip.category,
        estimatedTokenReductionPct: tip.estimatedTokenReductionPct,
        model: event.model?.family,
      });
    }
    if (event.adoptedPreviousTip !== undefined) {
      this.telemetry.suggestionAdopted({
        sessionId: event.sessionId,
        source,
        promptText: event.promptText,
        adopted: event.adoptedPreviousTip,
        model: event.model?.family,
      });
    }
  }

  /**
   * Play a scripted sequence of prompts that walks the ecosystem from a pristine
   * state down to collapse/dead and back, so users can see how prompt quality
   * drives Clippy's world. Real scoring powers the breakdown, coaching, and
   * impact metrics; the headline score is scripted so every state is reliably
   * demonstrated regardless of future heuristic tuning.
   */
  async runDemo(): Promise<void> {
    if (this.demoRunning) return;
    this.demoRunning = true;
    try {
      this.store.reset();
      this.log?.('demo: started — touring every ecosystem state.');
      let previous: number | null = null;
      for (const step of DEMO_STEPS) {
        await delay(DEMO_STEP_MS);
        const request: ScorePromptRequest = {
          sessionId: DEMO_SESSION,
          userId: 'demo',
          promptText: step.promptText,
          recentPrompts: step.recentPrompts,
          responseText: step.responseText,
          adoptedPreviousTip: step.adoptedPreviousTip,
          metadata: {
            promptLengthChars: step.promptText.length,
            estimatedInputTokens: step.inputTokens,
            estimatedOutputTokens: step.outputTokens,
            modelName: 'claude-opus-4.8',
          },
        };
        const real = scorePrompt(request, { previousScore: previous ?? undefined });
        const shown = {
          ...real,
          overallScore: step.score,
          wasteScore: clampScore(100 - step.score),
          delta: previous == null ? 0 : Math.round(step.score - previous),
        };
        const event = {
          promptText: step.promptText,
          responseText: step.responseText,
        } as PromptEvent;
        const tip = await this.maybeCoach(event, shown);
        this.store.recordScore(shown, {
          sessionId: DEMO_SESSION,
          source: 'manual',
          promptText: step.promptText,
          tip,
          tokens: real.tokens,
          forceHealth: step.score,
        });
        previous = step.score;
      }
      this.log?.('demo: complete.');
    } finally {
      this.demoRunning = false;
    }
  }

  private async maybeCoach(
    event: PromptEvent,
    resp: ReturnType<typeof scorePrompt>,
  ): Promise<TipView | undefined> {
    const categories = dominantWasteCategories(resp);
    if (resp.overallScore >= 85 && categories.length === 0) return undefined;

    try {
      const config = await this.getCoachConfig();
      const tip = await generateTip(
        {
          promptText: event.promptText,
          responseText: event.responseText,
          reasons: resp.reasons,
          improvements: resp.improvements,
          wasteCategories: categories,
          overallScore: resp.overallScore,
          model: event.model?.family,
        },
        config,
      );
      const pct = tip.estimatedSavings?.estimatedTokenReductionPct;
      const inputTokens = event.tokens?.inputTokens;
      return {
        message: tip.shortTip,
        rewrittenPrompt: tip.rewrittenPrompt,
        category: categories[0],
        estimatedTokenReductionPct: pct,
        estimatedLatencyReductionPct: tip.estimatedSavings?.estimatedLatencyReductionPct,
        estimatedTokensSaved:
          pct != null && inputTokens != null
            ? Math.round((inputTokens * pct) / 100)
            : undefined,
      };
    } catch {
      // Coaching never breaks scoring.
      if (resp.improvements.length > 0) {
        return { message: resp.improvements[0], category: categories[0] };
      }
      return undefined;
    }
  }
}
