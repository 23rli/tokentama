import { describe, it, expect } from 'vitest';
import { extractTargets, hasTarget, deriveInsights } from '../corpusInsights';
import type { CorpusRecord } from '../../data/corpusStore';

describe('extractTargets / hasTarget', () => {
  it('finds file and path targets', () => {
    const t = extractTargets('Refactor src/auth/login.ts to use one regex.');
    expect(t).toContain('src/auth/login.ts');
    expect(hasTarget('Refactor validateEmail in utils.ts.')).toBe(true);
  });

  it('reports no target for a vague prompt', () => {
    expect(hasTarget('fix the login flow please')).toBe(false);
  });

  it('does not treat abbreviations like e.g. as targets', () => {
    expect(hasTarget('do the thing, e.g. the usual')).toBe(false);
  });
});

function rec(promptText: string): CorpusRecord {
  return {
    v: 1,
    ts: '',
    sessionId: 's',
    turnIndex: 0,
    source: 'copilot',
    promptHash: 'h',
    promptChars: promptText.length,
    overallScore: 50,
    wasteScore: 50,
    wasteCategories: [],
    inputTokens: 100,
    outputTokens: 50,
    tokensReal: true,
    retryCount: 0,
    promptText,
  };
}

describe('deriveInsights', () => {
  it('surfaces the user\'s most frequent targets (seen >= twice)', () => {
    const records = [
      rec('fix src/auth/login.ts'),
      rec('add a test for src/auth/login.ts'),
      rec('tweak src/ui/button.tsx'),
    ];
    const { topTargets } = deriveInsights(records);
    expect(topTargets).toContain('src/auth/login.ts');
    expect(topTargets).not.toContain('src/ui/button.tsx'); // only seen once
  });

  it('is empty when raw text is unavailable', () => {
    const noText = { ...rec('x'), promptText: undefined };
    expect(deriveInsights([noText]).topTargets).toEqual([]);
  });
});
