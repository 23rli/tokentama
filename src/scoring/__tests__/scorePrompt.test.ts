import { describe, it, expect } from 'vitest';
import type { ScorePromptRequest } from '@tokentama/shared-types';
import { scorePrompt, dominantWasteCategories } from '../scorePrompt';

const base = { sessionId: 's1', userId: 'u1' };

describe('scorePrompt — efficient prompt', () => {
  const req: ScorePromptRequest = {
    ...base,
    promptText:
      'Summarize this design document in 5 bullets covering cost savings, risks, and next steps.',
    responseText: 'A short, bounded answer.',
    toolCalls: [],
    metadata: { promptLengthChars: 90, modelName: 'claude-opus-4.6' },
  };

  it('scores high and thrives', () => {
    const r = scorePrompt(req);
    expect(r.overallScore).toBeGreaterThanOrEqual(80);
    expect(r.wasteScore).toBeLessThanOrEqual(20);
    expect(r.petState).toBe('thriving');
  });

  it('keeps the overall = 100 - waste invariant', () => {
    const r = scorePrompt(req);
    expect(r.overallScore).toBe(Math.max(0, Math.min(100, 100 - r.wasteScore)));
  });

  it('rewards prompt quality and context efficiency', () => {
    const r = scorePrompt(req);
    expect(r.subscores.promptQuality).toBeGreaterThanOrEqual(70);
    expect(r.subscores.contextEfficiency).toBeGreaterThanOrEqual(90);
  });

  it('prices tokens with real rates', () => {
    const r = scorePrompt(req);
    expect(r.tokens?.estimated).toBe(true);
    expect(r.tokens?.inputTokens).toBeGreaterThan(0);
    expect(r.tokens?.estimatedCostUsd).toBeGreaterThanOrEqual(0);
  });
});

describe('scorePrompt — wasteful prompt', () => {
  const earlier =
    'Refactor the login function to support OAuth and add error handling for network failures and timeouts.';
  const req: ScorePromptRequest = {
    ...base,
    promptText: `${earlier} Still not working, try again, fix it.`,
    recentPrompts: [earlier],
    toolCalls: [
      { toolName: 'read_file', success: true },
      { toolName: 'read_file', success: false },
      { toolName: 'read_file', success: false },
      { toolName: 'grep', success: true },
      { toolName: 'grep', success: false },
      { toolName: 'read_file', success: false },
    ],
    metadata: { promptLengthChars: 150, retryCountInSession: 3, modelName: 'claude-opus-4.6' },
  };

  it('scores meaningfully lower and degrades the world', () => {
    const r = scorePrompt(req);
    expect(r.overallScore).toBeLessThanOrEqual(60);
    expect(['concerned', 'critical', 'collapse']).toContain(r.petState);
  });

  it('explains the waste with reasons and improvements', () => {
    const r = scorePrompt(req);
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.improvements.length).toBeGreaterThan(0);
  });

  it('identifies retry-loop and redundant-context as dominant waste', () => {
    const r = scorePrompt(req);
    const dominant = dominantWasteCategories(r);
    expect(dominant).toContain('retryLoop');
    expect(dominant).toContain('redundantContext');
  });

  it('drops tool efficiency for many failed/duplicated tool calls', () => {
    const r = scorePrompt(req);
    expect(r.subscores.toolEfficiency).toBeLessThan(60);
  });
});

describe('scorePrompt — deltas and learning adoption', () => {
  const req: ScorePromptRequest = {
    ...base,
    promptText: 'Write a concise function in 10 lines that validates an email address.',
  };

  it('computes delta from the previous score', () => {
    const r = scorePrompt(req, { previousScore: 40 });
    expect(r.delta).toBe(r.overallScore - 40);
  });

  it('reports zero delta with no previous score', () => {
    expect(scorePrompt(req).delta).toBe(0);
  });

  it('rewards adopting the previous tip', () => {
    const r = scorePrompt({ ...req, adoptedPreviousTip: true });
    expect(r.subscores.learningAdoption).toBeGreaterThanOrEqual(90);
  });

  it('penalizes ignoring the previous tip', () => {
    const r = scorePrompt({ ...req, adoptedPreviousTip: false });
    expect(r.subscores.learningAdoption).toBeLessThanOrEqual(50);
    expect(
      r.wasteBreakdown.find((c) => c.category === 'ignoredCoaching')?.severity,
    ).toBeGreaterThan(0);
  });
});
