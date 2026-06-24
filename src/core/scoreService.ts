import type { PromptEvent } from '@ecoprompt/shared-types';
import { dominantWasteCategories, scorePrompt } from '@ecoprompt/scoring-engine';
import { generateTip, type CoachConfig } from '@ecoprompt/llm-adapters';
import { SessionTracker, buildPromptEvent } from '../capture/parsers';
import type { GuardianStore } from '../state/guardianStore';
import type { TipView } from '../webview/contract';

const MANUAL_SESSION = 'manual-session';

/**
 * Orchestrates the score → coach → persist pipeline for both the manual command
 * and the passive Copilot watcher. Keeps a per-session SessionTracker so the
 * detectors get rolling context (recent prompts + retry counts).
 */
export class ScoreService {
  private readonly trackers = new Map<string, SessionTracker>();
  private manualTurn = 0;

  constructor(
    private readonly store: GuardianStore,
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
