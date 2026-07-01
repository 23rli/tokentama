import { describe, it, expect } from 'vitest';
import { RewriteService, cleanRewrite, type RewriteConfig } from '../rewriteService';
import type { CoachConfig } from '@tokentama/llm-adapters';

const coach: CoachConfig = { provider: 'none', apiVersion: '2024-10-21', timeoutMs: 12000 };
const emptyCorpus = { trainingPairs: () => [] };

function service(mode: RewriteConfig['mode']): RewriteService {
  return new RewriteService(emptyCorpus, async () => ({ mode, fewShotK: 3, coach }));
}

function serviceWithLlm(
  mode: RewriteConfig['mode'],
  llm: (system: string, user: string) => Promise<string>,
): RewriteService {
  return new RewriteService(emptyCorpus, async () => ({ mode, fewShotK: 3, coach }), llm);
}

describe('cleanRewrite', () => {
  it('strips code fences and surrounding quotes', () => {
    expect(cleanRewrite('```\nFix the bug.\n```')).toBe('Fix the bug.');
    expect(cleanRewrite('"Fix the bug."')).toBe('Fix the bug.');
  });
});

describe('RewriteService (offline)', () => {
  it('strips politeness for a padded prompt', async () => {
    const promptText =
      'Could you please, if it is not too much trouble, kindly help me make the thing work better. Thanks so much!';
    const r = await service('offline').rewrite({ promptText });
    expect(r.source).toBe('offline');
    expect(r.rewrittenPrompt).toBeTruthy();
    expect(r.rewrittenPrompt!.length).toBeLessThan(promptText.length);
    expect(r.rewrittenPrompt!.toLowerCase()).not.toContain('thanks');
    expect(r.rewrittenPrompt!.toLowerCase()).not.toContain('please');
  });

  it('no rewrite for an already-lean prompt', async () => {
    const r = await service('offline').rewrite({
      promptText: 'Add a unit test for parseEmail covering empty, valid, and malformed input.',
    });
    expect(r.rewrittenPrompt).toBeUndefined();
    expect(r.source).toBe('none');
  });

  it('mode=off yields nothing', async () => {
    const r = await service('off').rewrite({ promptText: 'anything at all here' });
    expect(r.source).toBe('none');
  });

  it('empty input yields nothing', async () => {
    const r = await service('offline').rewrite({ promptText: '   ' });
    expect(r.source).toBe('none');
  });
});

describe('RewriteService (auto / LM)', () => {
  it('always surfaces an explicitly-produced LM rewrite, even when longer (clarified)', async () => {
    const longer =
      'Refactor validateEmail in src/utils.ts to use one regex and return a typed Result; add a test for empty and malformed input.';
    const r = await serviceWithLlm('auto', async () => longer).rewrite({ promptText: 'fix the email thing' });
    expect(r.source).toBe('llm');
    expect(r.rewrittenPrompt).toBe(longer);
    expect(r.clarified).toBe(true);
  });

  it('reports % saved when the LM rewrite is shorter', async () => {
    const r = await serviceWithLlm('auto', async () => 'Fix login.').rewrite({
      promptText: 'Please could you kindly help me fix the login flow, thank you so much.',
    });
    expect(r.source).toBe('llm');
    expect(r.estimatedTokenReductionPct).toBeGreaterThan(0);
  });

  it('falls back to the offline cleanup when the LM fails', async () => {
    const r = await serviceWithLlm('auto', async () => {
      throw new Error('no access');
    }).rewrite({ promptText: 'Please kindly fix the bug, thanks!' });
    expect(r.source).toBe('offline');
    expect(r.rewrittenPrompt).toBeTruthy();
  });
});

describe('RewriteService (cost-aware auto gating)', () => {
  it('does NOT spend an LLM call on a short, already-specific prompt', async () => {
    let called = false;
    const svc = serviceWithLlm('auto', async () => {
      called = true;
      return 'x';
    });
    const r = await svc.rewrite({ promptText: 'Rename foo in bar.ts.' });
    expect(called).toBe(false); // offline handles it — no tokens spent
    expect(r.source).not.toBe('llm');
  });

  it('DOES use the LLM for a vague prompt with no named target', async () => {
    let called = false;
    const svc = serviceWithLlm('auto', async () => {
      called = true;
      return 'Fix the login flow in src/auth/login.ts and add a test.';
    });
    const r = await svc.rewrite({ promptText: 'fix the login' });
    expect(called).toBe(true);
    expect(r.source).toBe('llm');
  });

  it('mode=llm always uses the LLM regardless of length', async () => {
    let called = false;
    const svc = serviceWithLlm('llm', async () => {
      called = true;
      return 'Short.';
    });
    await svc.rewrite({ promptText: 'Rename foo in bar.ts.' });
    expect(called).toBe(true);
  });
});
