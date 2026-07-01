import { describe, it, expect } from 'vitest';
import { buildPortfolio, renderPortfolio } from '../userPortfolio';
import type { CorpusRecord } from '../../data/corpusStore';

function rec(
  promptText: string,
  opts: { wasteCategories?: string[]; retryCount?: number } = {},
): CorpusRecord {
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
    wasteCategories: opts.wasteCategories ?? [],
    inputTokens: 100,
    outputTokens: 50,
    tokensReal: true,
    retryCount: opts.retryCount ?? 0,
    promptText,
  };
}

describe('buildPortfolio', () => {
  it('learns frequent targets and format preference', () => {
    const records = [
      rec('add a test for src/auth/login.ts'),
      rec('write a test covering src/auth/login.ts'),
      rec('add a test to src/ui/button.tsx'),
      rec('another test somewhere'),
    ];
    const p = buildPortfolio(records);
    expect(p.topTargets).toContain('src/auth/login.ts');
    expect(p.prefersTests).toBe(true);
  });

  it('flags vagueness as a recurring problem when it correlates with retries', () => {
    const vague = [
      rec('fix the thing', { wasteCategories: ['vagueness'], retryCount: 2 }),
      rec('make it work', { wasteCategories: ['vagueness'], retryCount: 2 }),
      rec('do the stuff', { wasteCategories: ['vagueness'], retryCount: 1 }),
    ];
    const clean = [rec('refactor validateEmail in utils.ts', { retryCount: 0 })];
    const p = buildPortfolio([...vague, ...clean]);
    expect(p.problems.join(' ')).toMatch(/vague/i);
  });
});

describe('renderPortfolio', () => {
  it('always includes standards, and a profile when there is one', () => {
    const p = buildPortfolio([
      rec('add a test for src/auth/login.ts'),
      rec('test src/auth/login.ts again'),
    ]);
    const text = renderPortfolio(p);
    expect(text).toMatch(/STANDARDS:/);
    expect(text).toMatch(/YOUR PROFILE/);
    expect(text).toMatch(/src\/auth\/login\.ts/);
  });

  it('is just standards when there is no learned profile', () => {
    const text = renderPortfolio(buildPortfolio([]));
    expect(text).toMatch(/STANDARDS:/);
    expect(text).not.toMatch(/YOUR PROFILE/);
  });
});
