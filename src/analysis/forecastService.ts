import { forecastTurn, type Forecast, type TurnHistory } from './forecast';

/** A completed turn's real, metered signals — fed in as capture observes them. */
export interface RecordedTurn {
  promptTokens: number;
  completionTokens?: number;
  promptText?: string;
  toolCalls?: number;
}

export interface ModelLimits {
  maxInputTokens?: number;
  contextMaxTokens?: number;
}

/** Live, verifiable accuracy of the forecaster on THIS machine's real turns. */
export interface ForecastAccuracy {
  /** How many real turns have been scored so far. */
  samples: number;
  /** Median absolute % error of the point estimate (lower is better). */
  medianAbsPctError: number;
  /** Accuracy score = 100 − median error, clamped to [0,100]. */
  score: number;
  /** Fraction of real turns whose actual landed inside the predicted interval. */
  intervalCoverage: number;
  /** The most recent turn's absolute % error, for a live readout. */
  lastAbsPctError?: number;
}

/**
 * Stateful wrapper around the pure `forecastTurn`. It (1) accumulates the live
 * session's turn history from capture, (2) forecasts the next turn for the UI,
 * and (3) continuously scores its OWN past predictions against the real metered
 * tokens — so the panel can show a trustworthy, self-measured accuracy number
 * (the "keep an accuracy score somewhere for verification" requirement) rather
 * than a claim from an offline benchmark.
 *
 * Accuracy is scored the same way as `bench:forecast`: when a real turn N lands,
 * we re-derive what we WOULD have predicted from turns 0..N-1 plus turn N's own
 * prompt text, and compare to the real `promptTokens[N]`. This is independent of
 * whatever draft text was supplied, so it's an honest measure.
 */
export class ForecastService {
  private history: TurnHistory[] = [];
  private model: ModelLimits = {};
  private readonly apes: number[] = [];
  private intervalHits = 0;
  private intervalTotal = 0;
  private lastAbsPctError?: number;
  /** Cap the retained APE window so the score reflects recent behaviour. */
  private readonly maxSamples: number;

  constructor(opts: { maxSamples?: number } = {}) {
    this.maxSamples = opts.maxSamples ?? 200;
  }

  /** Reset when a new session/conversation begins (history and scoring restart). */
  reset(): void {
    this.history = [];
    // Accuracy is kept across sessions on purpose — it's a property of the model,
    // not of one conversation. Only the turn history resets.
  }

  /** Number of turns observed in the current session. */
  get turnCount(): number {
    return this.history.length;
  }

  /**
   * Observe a completed, real turn. Scores the prior prediction first, then
   * appends it to history. Model limits update from whatever the turn reports.
   */
  recordTurn(turn: RecordedTurn, model?: ModelLimits): void {
    if (model && (model.maxInputTokens || model.contextMaxTokens)) this.model = { ...this.model, ...model };

    // Score: what would we have predicted for THIS turn from prior history?
    if (this.history.length > 0 && turn.promptTokens > 0) {
      const predicted = forecastTurn({
        history: this.history,
        draftPrompt: turn.promptText ?? '',
        model: this.model,
      });
      // Don't count summarization resets against the point estimate — they're
      // surfaced via the reset flag, not predicted as a number.
      if (predicted.resetRisk !== 'high') {
        const ape = Math.abs(predicted.predictedInputTokens - turn.promptTokens) / turn.promptTokens;
        this.lastAbsPctError = ape;
        this.apes.push(ape);
        if (this.apes.length > this.maxSamples) this.apes.shift();
        this.intervalTotal++;
        if (turn.promptTokens >= predicted.interval.low && turn.promptTokens <= predicted.interval.high) {
          this.intervalHits++;
        }
      }
    }

    this.history.push({
      promptTokens: turn.promptTokens,
      completionTokens: turn.completionTokens,
      promptText: turn.promptText,
      toolCalls: turn.toolCalls,
    });
  }

  /** Forecast the next turn, optionally conditioned on draft text. */
  forecastNext(draftPrompt = ''): Forecast {
    return forecastTurn({ history: this.history, draftPrompt, model: this.model });
  }

  /** The live, self-measured accuracy of the forecaster. */
  accuracy(): ForecastAccuracy {
    const samples = this.apes.length;
    const md = samples ? median(this.apes) : 0;
    return {
      samples,
      medianAbsPctError: md,
      score: samples ? clamp(100 - md * 100, 0, 100) : 0,
      intervalCoverage: this.intervalTotal ? this.intervalHits / this.intervalTotal : 0,
      lastAbsPctError: this.lastAbsPctError,
    };
  }
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
