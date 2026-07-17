import { describe, expect, it } from 'vitest';
import type { ForecastView } from '../../../src/webview/contract';
import { countInFlightTurns } from './ForecastPanel';

describe('countInFlightTurns', () => {
  it('counts only genuine pending turns', () => {
    const turns: NonNullable<ForecastView['allTurns']> = [
      { prompt: 'full', tokens: 100, metered: true, status: 'metered' },
      { prompt: 'input only', tokens: 80, metered: false, partial: true, status: 'input-only' },
      { prompt: 'output only', tokens: 20, metered: false, partial: true, status: 'output-only' },
      { prompt: 'missing', tokens: 0, metered: false, status: 'unavailable' },
      { prompt: 'now', tokens: 0, metered: false, status: 'pending' },
    ];
    expect(countInFlightTurns(turns)).toBe(1);
  });
});