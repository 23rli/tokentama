import { describe, it, expect } from 'vitest';
import { ScoreService } from '../scoreService';
import type { TamaStore } from '../../state/tamaStore';
import type { CoachConfig } from '@tokentama/llm-adapters';

// scoreDraft is pure (offline heuristic, no store/telemetry access), so we can
// construct the service with stub dependencies.
function makeService(): ScoreService {
  const store = {
    getState: () => ({ model: undefined }),
    currentModel: () => undefined,
  } as unknown as TamaStore;
  const getCoachConfig = async (): Promise<CoachConfig> => ({ provider: 'none' }) as CoachConfig;
  return new ScoreService(store, getCoachConfig);
}

describe('ScoreService.scoreDraft (compose box)', () => {
  it('returns a score without touching session state', () => {
    const svc = makeService();
    const r = svc.scoreDraft('Add a unit test for parseEmail covering empty and malformed input.');
    expect(r.overallScore).toBeGreaterThan(0);
    expect(r.overallScore).toBeLessThanOrEqual(100);
    expect(r.inputTokens).toBeGreaterThan(0);
  });

  it('offers a leaner rewrite for a padded, vague prompt', () => {
    const svc = makeService();
    const r = svc.scoreDraft(
      'Could you please, if it is not too much trouble, kindly help me make the thing work better, you know what I mean.',
    );
    expect(r.rewrittenPrompt).toBeTruthy();
    expect(r.tip).toBeTruthy();
  });

  it('is deterministic and safe for empty input', () => {
    const svc = makeService();
    const a = svc.scoreDraft('');
    const b = svc.scoreDraft('');
    expect(a).toEqual(b);
    expect(a.rewrittenPrompt).toBeUndefined();
  });
});
