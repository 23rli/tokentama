import { describe, it, expect } from 'vitest';
import { predictRetryRisk, similarRetryStats } from '../retryRisk';
import type { WasteComponent, WasteCategory } from '@tokentama/shared-types';
import type { CorpusRecord } from '../../data/corpusStore';

const wb = (category: WasteCategory, severity: number): WasteComponent => ({
  category,
  severity,
  weightedPoints: severity * 100,
  reason: '',
});

describe('predictRetryRisk', () => {
  it('flags a vague, low-scoring prompt as high risk', () => {
    const r = predictRetryRisk({ wasteBreakdown: [wb('vagueness', 0.9)], overallScore: 25 });
    expect(r.level).toBe('high');
    expect(r.reasons.join(' ')).toMatch(/underspecified/);
  });

  it('treats a clean, high-scoring prompt as low risk', () => {
    expect(predictRetryRisk({ wasteBreakdown: [], overallScore: 95 }).level).toBe('low');
  });

  it('raises risk from a personalized retry prior', () => {
    const base = predictRetryRisk({ wasteBreakdown: [], overallScore: 70 });
    const withPrior = predictRetryRisk(
      { wasteBreakdown: [], overallScore: 70 },
      { priorAvgRetries: 2 },
    );
    expect(withPrior.risk).toBeGreaterThan(base.risk);
    expect(withPrior.reasons.join(' ')).toMatch(/averaged 2\.0 retries/);
  });
});

function rec(wasteCategories: string[], retryCount: number, model?: string): CorpusRecord {
  return {
    v: 1,
    ts: '',
    sessionId: 's',
    turnIndex: 0,
    source: 'copilot',
    promptHash: 'h',
    promptChars: 10,
    overallScore: 40,
    wasteScore: 60,
    wasteCategories,
    inputTokens: 100,
    outputTokens: 50,
    tokensReal: true,
    retryCount,
    model,
  };
}

describe('similarRetryStats', () => {
  it('averages retries over prompts sharing a waste category', () => {
    const records = [
      rec(['vagueness'], 2),
      rec(['vagueness'], 1),
      rec(['vagueness'], 0),
      rec(['verbosityMismatch'], 5),
    ];
    const s = similarRetryStats(records, ['vagueness']);
    expect(s).toEqual({ count: 3, avgRetries: 1 });
  });

  it('returns undefined below the minimum sample', () => {
    expect(similarRetryStats([rec(['vagueness'], 3)], ['vagueness'])).toBeUndefined();
  });

  it('filters by model when provided', () => {
    const records = [
      rec(['vagueness'], 2, 'gpt'),
      rec(['vagueness'], 2, 'gpt'),
      rec(['vagueness'], 0, 'claude-opus'),
    ];
    expect(similarRetryStats(records, ['vagueness'], 'gpt')).toBeUndefined(); // only 2 gpt matches
  });
});
