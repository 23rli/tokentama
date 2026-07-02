import { describe, it, expect } from 'vitest';
import { retrievePairs, buildRewriteMessages } from '../corpusRetrieval';
import type { TrainingPair } from '../../data/corpusStore';

const pairs: TrainingPair[] = [
  { input: 'Add a unit test for parseEmail covering empty and malformed input.', output: 'Test parseEmail: empty + malformed.', wasteCategories: [] },
  { input: 'Refactor the auth login to use one regex.', output: 'Refactor auth login to one regex.', wasteCategories: [], model: 'gpt' },
  { input: 'Please kindly help me make the thing work better you know.', output: 'Make the thing work.', wasteCategories: ['vagueness'], model: 'claude-opus' },
];

describe('retrievePairs', () => {
  it('ranks the most similar example first', () => {
    const out = retrievePairs(pairs, 'Add a unit test for parseEmail covering empty input.', { k: 1 });
    expect(out).toHaveLength(1);
    expect(out[0].input).toContain('parseEmail');
  });

  it('respects k', () => {
    expect(retrievePairs(pairs, 'anything', { k: 2 })).toHaveLength(2);
  });

  it('softly boosts same-model examples', () => {
    const out = retrievePairs(pairs, 'unrelated text about widgets', { k: 1, model: 'claude-opus' });
    expect(out[0].model).toBe('claude-opus');
  });
});

describe('buildRewriteMessages', () => {
  it('includes examples and the target prompt', () => {
    const { system, user } = buildRewriteMessages('Fix the thing.', pairs.slice(0, 1));
    expect(system).toMatch(/first try/);
    expect(system).toMatch(/NEVER invent/);
    expect(user).toContain('parseEmail');
    expect(user).toContain('Fix the thing.');
  });

  it('works with no examples', () => {
    const { user } = buildRewriteMessages('Fix the thing.', []);
    expect(user).toContain('Fix the thing.');
  });
});
