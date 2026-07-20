/**
 * Turn-cost forecaster.
 *
 * Goal: given a draft prompt + the session so far + the model, best-estimate the
 * INPUT tokens (and therefore the credits) the NEXT turn will cost — and show
 * where that cost comes from. We do NOT claim to
 * reduce it; this is honest forecasting/visibility only.
 *
 * The structural fact this leans on (see docs §3.6, §9): a turn's input is
 *   promptTokens[N] ≈ promptTokens[N-1]            (all prior context, re-sent)
 *                    + completionTokens[N-1]        (last answer, now in history)
 *                    + toolResultTokens[N-1]        (tool outputs added to history)
 *                    + estimateTokens(draft[N])     (your new message — a sliver)
 * We can't meter tool-result tokens directly, so we LEARN that per-turn growth
 * from the session's own history (the residual after accounting for the known
 * parts). Everything is deterministic and unit-testable.
 */
import { estimateTokens } from '../scoring/models/tokenizer';

/** One prior turn's real metered counts (+ the user's message text for that turn). */
export interface TurnHistory {
  promptTokens: number;
  completionTokens?: number;
  /** The user's message that opened this turn — used to size its text contribution. */
  promptText?: string;
  /**
   * Number of tool calls this turn made (from the transcript, already on disk).
   * Optional — when present, the growth estimate uses the prior turn's tool
   * activity instead of a flat session-median, which measurably reduces error
   * (see `bench:forecast:improve`). Free: no model call.
   */
  toolCalls?: number;
}

export interface ForecastInput {
  /** Prior turns in chronological order (may be empty for a cold start). */
  history: TurnHistory[];
  /** The prompt the user is about to send. */
  draftPrompt: string;
  /**
   * Optional model metadata. Used ONLY to make reset detection model-relative
   * (different models/harnesses summarize at very different absolute token
   * counts). Everything else is learned from the session's own data, so the
   * forecaster adapts to any model — Auto, a 128k model, a 1M session — without
   * per-model constants.
   */
  model?: { maxInputTokens?: number; contextMaxTokens?: number };
}

export interface ForecastBreakdown {
  /** Context carried forward and re-sent: prior input + the last answer. */
  carriedContext: number;
  /** Learned per-turn growth (tool results + expansion added to history). */
  growth: number;
  /** Your new message — usually a tiny sliver of the total. */
  draft: number;
}

export interface Forecast {
  /** Best estimate of the next turn's full INPUT tokens. */
  predictedInputTokens: number;
  /** Calibrated prediction interval — the honest "right every time" band. */
  interval: { low: number; high: number };
  breakdown: ForecastBreakdown;
  /** 'structural' once we have history; 'coldstart' for the first turn. */
  basis: 'structural' | 'coldstart';
  /** 0..1 — rises with history length, falls with growth variance / reset risk. */
  confidence: number;
  /**
   * 'high' when we're near the context ceiling and a summarization RESET is
   * likely on the next turn (context collapses to a small recap). In that state
   * the point estimate is unreliable BY NATURE — we flag it instead of pretending.
   */
  resetRisk: 'low' | 'high';
  /** When resetRisk is 'high', the estimated size AFTER a summarization reset. */
  resetBaseline?: number;
}

/** A reasonable first-turn baseline (system + tool defs) when we have no history. */
const COLD_START_OVERHEAD = 12_000;

/**
 * FALLBACK interval multipliers, used only until we have enough history to
 * self-calibrate. Once we do, the band is derived from THIS session's own
 * actual/predicted spread (see `calibrateInterval`), so it adapts to whatever
 * model/tokenizer/harness produced the data — no per-model constant.
 */
const DEFAULT_INTERVAL_LOW = 0.77;
const DEFAULT_INTERVAL_HIGH = 1.21;
/** Need at least this many past turns before trusting the session's own spread. */
const MIN_RATIOS_FOR_CALIBRATION = 5;

/**
 * Reset (native summarization) fires as context nears the model's limit. We do
 * NOT hardcode an absolute ceiling — that's what made the old model fragile
 * across models. Instead we use, in order: (1) the session's OWN observed
 * summarization trigger, (2) a fraction of the real model limit, else (3) we
 * don't flag (we won't guess a model we know nothing about).
 */
const MODEL_LIMIT_RESET_FRACTION = 0.9; // only warn when genuinely near the context window
const RESET_ZONE = 0.97; // within this fraction of the trigger → flag
const DEFAULT_RESET_FRACTION = 0.06; // post-reset size as a fraction of the trigger (fallback)

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function quantileAsc(sortedAsc: number[], q: number): number {
  if (!sortedAsc.length) return 0;
  const pos = (sortedAsc.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sortedAsc[base + 1] !== undefined
    ? sortedAsc[base] + rest * (sortedAsc[base + 1] - sortedAsc[base])
    : sortedAsc[base];
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Per-turn growth we couldn't attribute to the known parts (≈ tool-result tokens
 * added to history). Learned from the session's own turns, so it adapts to how
 * tool-heavy this particular conversation is.
 */
function learnGrowth(history: TurnHistory[]): { growth: number; variance: number } {
  const residuals: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const cur = history[i];
    const known = prev.promptTokens + (prev.completionTokens ?? 0) + estimateTokens(cur.promptText);
    residuals.push(Math.max(0, cur.promptTokens - known));
  }
  if (residuals.length === 0) return { growth: 0, variance: 0 };
  const med = median(residuals);
  const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const variance = residuals.reduce((a, b) => a + (b - mean) ** 2, 0) / residuals.length;
  // Normalised spread (coefficient of variation), clamped for the confidence signal.
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

  // Tool-aware refinement (free — tool-call counts are already on disk when the
  // caller supplies them): the growth into a turn is driven by the PRIOR turn's
  // tool activity, so scale by a learned per-tool token rate. Blended as a
  // surge-aware floor (max with the median) so a noisy early rate can never
  // underestimate. Falls back to the plain median when no tool data is present.
  let growth = med;
  const last = history[history.length - 1];
  if (typeof last.toolCalls === 'number') {
    const rates: number[] = [];
    for (let i = 1; i < history.length; i++) {
      const tc = history[i - 1].toolCalls;
      if (typeof tc === 'number' && tc > 0) rates.push(residuals[i - 1] / tc);
    }
    if (rates.length >= 3) {
      const toolEstimate = median(rates) * last.toolCalls;
      growth = Math.max(med, toolEstimate);
    }
  }
  return { growth, variance: cv };
}

/** The core point prediction — shared by the forecast and its self-calibration. */
function pointPredict(history: TurnHistory[], draftTokens: number): number {
  if (history.length === 0) return COLD_START_OVERHEAD + draftTokens;
  const last = history[history.length - 1];
  const carriedContext = last.promptTokens + (last.completionTokens ?? 0);
  const { growth } = learnGrowth(history);
  return Math.round(carriedContext + growth + draftTokens);
}

/**
 * Self-calibrate the prediction interval from THIS session's own history: replay
 * the point predictor over past turns, collect actual/predicted ratios, and use
 * their p05/p95 as the band. Ratios are scale-free, so this is invariant to the
 * model's tokenizer/context size — the band widens for volatile sessions and
 * tightens for steady ones automatically. Falls back to defaults early on.
 * Reset turns (actual ≪ predicted) are excluded — the reset flag handles those.
 */
function calibrateInterval(history: TurnHistory[]): { low: number; high: number } {
  const ratios: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const point = pointPredict(history.slice(0, i), estimateTokens(history[i].promptText));
    const actual = history[i].promptTokens;
    if (point > 0 && actual > 0) {
      const r = actual / point;
      if (r >= 0.2 && r <= 8) ratios.push(r); // drop summarization-reset artefacts
    }
  }
  if (ratios.length < MIN_RATIOS_FOR_CALIBRATION) {
    return { low: DEFAULT_INTERVAL_LOW, high: DEFAULT_INTERVAL_HIGH };
  }
  const s = ratios.sort((a, b) => a - b);
  return {
    low: clamp(quantileAsc(s, 0.05), 0.3, 0.98),
    high: clamp(quantileAsc(s, 0.95), 1.02, 4),
  };
}

/**
 * The token level at which this session is likely to summarize (reset). Combines
 * every signal we have and takes the EARLIEST (smallest) danger level: the
 * session's own observed trigger, and/or a fraction of the real model limit. If
 * we have neither, we return Infinity and never flag — we won't guess a model we
 * know nothing about. This is what makes reset detection model-agnostic: no
 * absolute constant, and it catches resets near the real limit even before the
 * session's first observed one.
 */
function resetTrigger(history: TurnHistory[], model?: ForecastInput['model']): number {
  const candidates: number[] = [];
  let observed = 0;
  for (let i = 1; i < history.length; i++) {
    if (history[i].promptTokens < history[i - 1].promptTokens * 0.6) {
      observed = Math.max(observed, history[i - 1].promptTokens);
    }
  }
  if (observed > 0) candidates.push(observed);
  // Prefer the FULL context window (contextMaxTokens) — that's what the model
  // summarizes against and what Copilot shows — over the input-only cap.
  const limit = model?.contextMaxTokens ?? model?.maxInputTokens;
  if (limit && limit > 0) candidates.push(limit * MODEL_LIMIT_RESET_FRACTION);
  return candidates.length ? Math.min(...candidates) : Infinity;
}

export function forecastTurn(input: ForecastInput): Forecast {
  const draft = estimateTokens(input.draftPrompt);
  const history = input.history.filter((h) => Number.isFinite(h.promptTokens) && h.promptTokens > 0);

  if (history.length === 0) {
    const predicted = COLD_START_OVERHEAD + draft;
    return {
      predictedInputTokens: predicted,
      interval: {
        low: Math.round(predicted * DEFAULT_INTERVAL_LOW),
        high: Math.round(predicted * DEFAULT_INTERVAL_HIGH),
      },
      breakdown: { carriedContext: COLD_START_OVERHEAD, growth: 0, draft },
      basis: 'coldstart',
      confidence: 0.2,
      resetRisk: 'low',
    };
  }

  const last = history[history.length - 1];
  const carriedContext = last.promptTokens + (last.completionTokens ?? 0);
  const { growth, variance } = learnGrowth(history);

  const breakdown: ForecastBreakdown = { carriedContext, growth, draft };
  const point = Math.round(carriedContext + growth + draft);

  // Reset detection: model-relative trigger, not a hardcoded ceiling.
  const trigger = resetTrigger(history, input.model);
  const resetBaseline = estimateResetBaseline(history, Number.isFinite(trigger) ? trigger : Math.max(...history.map((h) => h.promptTokens)));
  const inResetZone = Number.isFinite(trigger) && point >= trigger * RESET_ZONE;

  // Confidence: more turns → steadier; high growth variance → less sure.
  const lengthScore = Math.min(1, history.length / 8);
  const steadiness = Math.max(0, 1 - Math.min(1, variance));
  let confidence = Math.round((0.5 * lengthScore + 0.5 * steadiness) * 100) / 100;

  // Self-calibrated interval from this session's own spread (model-agnostic).
  const band = calibrateInterval(history);
  let low = Math.round(point * band.low);
  const high = Math.round(point * band.high);
  let resetRisk: 'low' | 'high' = 'low';
  if (inResetZone) {
    // Near the trigger the outcome is bimodal: ~current, OR a summarization reset
    // to ~resetBaseline. Widen the interval down to cover the reset and cap
    // confidence — a tight point here would be dishonest.
    resetRisk = 'high';
    low = Math.min(low, Math.round(resetBaseline * 0.85));
    confidence = Math.min(confidence, 0.2);
  }

  return {
    predictedInputTokens: point,
    interval: { low, high },
    breakdown,
    basis: 'structural',
    confidence,
    resetRisk,
    resetBaseline: inResetZone ? resetBaseline : undefined,
  };
}

/**
 * Estimate the post-summarization size. If the session has already summarized
 * (a sharp drop from a high peak), reuse the smallest such trough; otherwise fall
 * back to a fraction of the ceiling seen on real resets (~6%).
 */
function estimateResetBaseline(history: TurnHistory[], ceiling: number): number {
  const troughs: number[] = [];
  for (let i = 1; i < history.length; i++) {
    if (history[i].promptTokens < history[i - 1].promptTokens * 0.6) {
      troughs.push(history[i].promptTokens);
    }
  }
  if (troughs.length) return median(troughs);
  return Math.round(ceiling * DEFAULT_RESET_FRACTION);
}

/** Naive baselines, kept so the accuracy harness can prove the structural model wins. */
export function forecastLastValue(input: ForecastInput): number {
  const h = input.history.filter((x) => x.promptTokens > 0);
  return h.length ? h[h.length - 1].promptTokens : COLD_START_OVERHEAD;
}

export function forecastEmaDelta(input: ForecastInput): number {
  const h = input.history.filter((x) => x.promptTokens > 0);
  if (h.length < 2) return h.length ? h[h.length - 1].promptTokens : COLD_START_OVERHEAD;
  let ema = h[1].promptTokens - h[0].promptTokens;
  const alpha = 0.5;
  for (let i = 2; i < h.length; i++) ema = alpha * (h[i].promptTokens - h[i - 1].promptTokens) + (1 - alpha) * ema;
  return Math.max(0, h[h.length - 1].promptTokens + ema);
}
