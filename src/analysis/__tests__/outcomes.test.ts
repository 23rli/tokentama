import { describe, it, expect } from 'vitest';
import { computeOutcomes } from '../outcomes';
import type { CorpusRecord } from '../../data/corpusStore';

function rec(adopted: boolean | undefined, retryCount: number, inputTokens = 1000): CorpusRecord {
  return {
    v: 1,
    ts: '',
    sessionId: 's',
    turnIndex: 0,
    source: 'copilot',
    promptHash: 'h',
    promptChars: 10,
    overallScore: 50,
    wasteScore: 50,
    wasteCategories: [],
    inputTokens,
    outputTokens: 100,
    tokensReal: true,
    retryCount,
    adopted,
  };
}

describe('computeOutcomes', () => {
  it('has no signal below the minimum sample', () => {
    const r = computeOutcomes([rec(true, 0), rec(false, 1)]);
    expect(r.hasSignal).toBe(false);
    expect(r.retryReductionPct).toBeUndefined();
  });

  it('quantifies retry reduction when adoption lowers retries', () => {
    const adopted = Array.from({ length: 10 }, (_, i) => rec(true, i < 1 ? 1 : 0)); // 10% retry
    const notAdopted = Array.from({ length: 10 }, (_, i) => rec(false, i < 5 ? 1 : 0)); // 50% retry
    const r = computeOutcomes([...adopted, ...notAdopted]);
    expect(r.hasSignal).toBe(true);
    expect(r.retryRateAdopted).toBeCloseTo(0.1, 5);
    expect(r.retryRateNotAdopted).toBeCloseTo(0.5, 5);
    expect(r.retryReductionPct).toBe(80); // (0.5-0.1)/0.5
    expect(r.estRetriesAvoided).toBe(4); // 0.4 * 10
    expect(r.estTokensSaved).toBe(4000); // 4 * 1000 avg input
  });

  it('reports overall retry rate', () => {
    const r = computeOutcomes([rec(true, 1), rec(false, 0), rec(undefined, 1)]);
    expect(r.retryRate).toBeCloseTo(2 / 3, 5);
    expect(r.totalTurns).toBe(3);
  });
});
