import type { PromptEvent, ScorePromptRequest } from '@tokentama/shared-types';
import { dominantWasteCategories, scorePrompt, clampScore } from '@tokentama/scoring-engine';
import { generateTip, type CoachConfig } from '@tokentama/llm-adapters';
import { SessionTracker, buildPromptEvent } from '../capture/parsers';
import type { TamaStore } from '../state/tamaStore';
import type { TipView } from '../webview/contract';

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
  private manualTurn = 0;
  private demoRunning = false;

  constructor(
    private readonly store: TamaStore,
    private readonly getCoachConfig: () => Promise<CoachConfig>,
    private readonly log?: (message: string) => void,
  ) {}

  private tracker(sessionId: string): SessionTracker {
    let t = this.trackers.get(sessionId);
    if (!t) {
      t = new SessionTracker();
      this.trackers.set(sessionId, t);
    }
    return t;
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
  async scoreEvent(event: PromptEvent, source: 'manual' | 'copilot'): Promise<number> {
    const request = this.tracker(event.sessionId).toScoreRequest(event);
    const previousScore = this.store.latestOverall(event.sessionId);
    const resp = scorePrompt(request, { previousScore: previousScore ?? undefined });

    const tip = await this.maybeCoach(event, resp);
    this.store.recordScore(resp, {
      sessionId: event.sessionId,
      source,
      promptText: event.promptText,
      tip,
      tokens: event.tokens,
      model: event.model,
    });
    this.log?.(
      `scored (${source}): overall ${Math.round(resp.overallScore)} · waste ${Math.round(
        resp.wasteScore,
      )}`,
    );
    return resp.overallScore;
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
      return {
        message: tip.shortTip,
        rewrittenPrompt: tip.rewrittenPrompt,
        category: categories[0],
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
