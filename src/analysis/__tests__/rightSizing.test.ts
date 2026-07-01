import { describe, it, expect } from 'vitest';
import { classifyDifficulty } from '../taskDifficulty';
import { modelRightSizing, effortRightSizing } from '../rightSizing';
import type { ModelInfo } from '@tokentama/shared-types';

describe('classifyDifficulty', () => {
  it('marks a short mechanical edit as trivial', () => {
    expect(classifyDifficulty('Rename the variable foo to bar.').level).toBe('trivial');
    expect(classifyDifficulty('Add a JSDoc comment to parseEmail.').level).toBe('trivial');
  });

  it('marks design/refactor/perf work as complex', () => {
    expect(
      classifyDifficulty('Refactor the auth architecture across files and optimize performance.')
        .level,
    ).toBe('complex');
    expect(classifyDifficulty('Investigate why the request deadlocks under load.').level).toBe(
      'complex',
    );
  });

  it('falls back to moderate for ordinary asks', () => {
    expect(
      classifyDifficulty('Write a function that validates an email and returns a Result.').level,
    ).toBe('moderate');
  });
});

const premiumHigh: ModelInfo = {
  id: 'claude-opus-4.8',
  family: 'claude-opus-4.8',
  name: 'Claude Opus 4.8',
  category: 'powerful',
  priceCategory: 'high',
  reasoningEffort: 'high',
  reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
};
const cheap: ModelInfo = { id: 'gpt', family: 'gpt', category: 'general', priceCategory: 'standard' };

describe('modelRightSizing', () => {
  it('recommends a lighter model for a trivial task on a premium model', () => {
    expect(modelRightSizing('trivial', premiumHigh).recommend).toBe(true);
  });
  it('does not recommend for a complex task', () => {
    expect(modelRightSizing('complex', premiumHigh).recommend).toBe(false);
  });
  it('does not recommend when already on a cheaper model', () => {
    expect(modelRightSizing('trivial', cheap).recommend).toBe(false);
  });
});

describe('effortRightSizing', () => {
  it('suggests a lower effort for a trivial task at high effort', () => {
    const r = effortRightSizing('trivial', premiumHigh);
    expect(r.recommend).toBe(true);
    expect(r.message).toMatch(/'medium'/);
  });
  it('does nothing for a moderate task', () => {
    expect(effortRightSizing('moderate', premiumHigh).recommend).toBe(false);
  });
  it('does nothing when effort is already low', () => {
    expect(
      effortRightSizing('trivial', { ...premiumHigh, reasoningEffort: 'low' }).recommend,
    ).toBe(false);
  });
});
