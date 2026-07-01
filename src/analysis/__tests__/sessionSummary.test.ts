import { describe, it, expect } from 'vitest';
import { buildSessionSummary } from '../sessionSummary';

describe('buildSessionSummary', () => {
  it('produces a compact, numbered recap of the prompts', () => {
    const s = buildSessionSummary([
      'Could you please add a unit test for parseEmail covering empty input.',
      'Refactor validateEmail to use one regex.',
    ]);
    expect(s).toMatch(/Context recap/);
    expect(s).toContain('1.');
    expect(s).toContain('2.');
    expect(s).toMatch(/parseEmail/);
  });

  it('dedupes repeated prompts and caps the count', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Do task number ${i}.`);
    const withDupes = [...many, 'Do task number 5.'];
    const s = buildSessionSummary(withDupes, 12);
    const lines = s.split('\n').filter((l) => /^\d+\./.test(l));
    expect(lines.length).toBe(12);
  });

  it('handles an empty session gracefully', () => {
    expect(buildSessionSummary([])).toBe('Continue the previous task.');
    expect(buildSessionSummary(['   '])).toBe('Continue the previous task.');
  });
});
