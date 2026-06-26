import { describe, it, expect } from 'vitest';
import type { TipRequest } from '@tokentama/shared-types';
import { heuristicGenerateTip, heuristicRewrite } from '../heuristicCoach';
import { generateTip } from '../coach';
import { isCoachConfigured, loadCoachConfig } from '../config';

const wastefulReq: TipRequest = {
  promptText:
    'Refactor the data layer. Refactor the data layer. Still not working, try again, just fix it.',
  reasons: ['This prompt repeats sentences already in the prompt.'],
  improvements: ['Reference earlier context instead of re-pasting it.'],
  wasteCategories: ['redundantContext', 'retryLoop', 'vagueness'],
  overallScore: 35,
};

const cleanReq: TipRequest = {
  promptText: 'Summarize the doc in 5 bullets.',
  reasons: [],
  improvements: [],
  wasteCategories: [],
  overallScore: 96,
};

describe('heuristicRewrite', () => {
  it('dedupes repeated sentences and strips retry filler', () => {
    const rewrite = heuristicRewrite(wastefulReq.promptText, wastefulReq.wasteCategories);
    expect(rewrite.toLowerCase()).toContain('refactor the data layer');
    // The duplicate sentence should not appear twice.
    expect(rewrite.toLowerCase().match(/refactor the data layer/g)?.length).toBe(1);
    expect(rewrite.toLowerCase()).not.toContain('still not working');
    expect(rewrite.toLowerCase()).toContain('reference earlier');
  });
});

describe('heuristicGenerateTip', () => {
  it('produces a short tip, rewrite, and savings for a wasteful prompt', () => {
    const tip = heuristicGenerateTip(wastefulReq);
    expect(tip.source).toBe('heuristic');
    expect(tip.shortTip.length).toBeGreaterThan(0);
    expect(tip.rewrittenPrompt).toBeTruthy();
    expect(tip.estimatedSavings?.estimatedTokenReductionPct).toBeGreaterThan(0);
  });

  it('praises an efficient prompt with no rewrite', () => {
    const tip = heuristicGenerateTip(cleanReq);
    expect(tip.rewrittenPrompt).toBeUndefined();
    expect(tip.estimatedSavings).toBeUndefined();
    expect(tip.shortTip.toLowerCase()).toContain('efficient');
  });
});

describe('generateTip (default config)', () => {
  it('falls back to the heuristic coach when no LLM is configured', async () => {
    const tip = await generateTip(wastefulReq, loadCoachConfig({} as NodeJS.ProcessEnv));
    expect(tip.source).toBe('heuristic');
  });

  it('treats an unconfigured provider as not configured', () => {
    expect(isCoachConfigured(loadCoachConfig({} as NodeJS.ProcessEnv))).toBe(false);
    expect(
      isCoachConfigured(
        loadCoachConfig({
          ECO_LLM_PROVIDER: 'openai',
          ECO_LLM_API_KEY: 'k',
          ECO_LLM_ENDPOINT: 'https://x',
        } as NodeJS.ProcessEnv),
      ),
    ).toBe(true);
  });
});
