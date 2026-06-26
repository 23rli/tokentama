import { describe, it, expect } from 'vitest';
import type { ScorePromptRequest } from '@ecoprompt/shared-types';
import { scorePrompt } from '../scorePrompt';

const base = { sessionId: 's', userId: 'u' };

describe('scorePrompt — stability & determinism', () => {
  it('produces identical scores for identical prompts', () => {
    const req: ScorePromptRequest = {
      ...base,
      promptText: 'Write a Python function that validates an email address and returns a boolean.',
    };
    const a = scorePrompt(req);
    const b = scorePrompt(req);
    expect(a.overallScore).toBe(b.overallScore);
    expect(a.wasteScore).toBe(b.wasteScore);
  });

  it('scores near-identical prompts within a few points (no threshold cliffs)', () => {
    const p1 = scorePrompt({
      ...base,
      promptText: 'Write a Python function to validate an email address and return a boolean.',
    });
    const p2 = scorePrompt({
      ...base,
      promptText:
        'Write a Python function that validates an email address and returns true or false.',
    });
    expect(Math.abs(p1.overallScore - p2.overallScore)).toBeLessThanOrEqual(8);
  });

  it('does not let the response size dominate the score', () => {
    const prompt = 'Summarize the architecture doc in 5 bullets covering risks and next steps.';
    const short = scorePrompt({ ...base, promptText: prompt, responseText: 'Short answer.' });
    const long = scorePrompt({ ...base, promptText: prompt, responseText: 'x '.repeat(4000) });
    expect(Math.abs(short.overallScore - long.overallScore)).toBeLessThanOrEqual(3);
  });

  it('flags a padded, over-polite prompt as verbose', () => {
    const r = scorePrompt({
      ...base,
      promptText:
        'Could you please, if it is not too much trouble, kindly and thoroughly help me to ' +
        'maybe possibly write some code that does the thing, you know what i mean, like the usual stuff.',
    });
    const verbosity = r.wasteBreakdown.find((c) => c.category === 'verbosityMismatch');
    expect(verbosity?.severity ?? 0).toBeGreaterThan(0.3);
  });
});
