import type { WasteComponent } from '@tokentama/shared-types';
import type { CorpusRecord } from '../data/corpusStore';

/**
 * Estimate the risk that a prompt will need a RETRY.
 *
 * Retries are the dominant cost: a re-ask re-sends the entire ~overhead-heavy
 * turn, so preventing one saves far more than trimming the message. Risk comes
 * from the draft's own signals (vagueness, retry cues, low score) and — when we
 * have history — a personalized prior from the user's own corpus.
 */
export interface RetryRisk {
  /** 0..1 probability-ish score. */
  risk: number;
  level: 'low' | 'medium' | 'high';
  reasons: string[];
}

interface DraftSignal {
  wasteBreakdown: WasteComponent[];
  overallScore: number;
}

function severity(bd: WasteComponent[], category: string): number {
  return bd.find((c) => c.category === category)?.severity ?? 0;
}

export function predictRetryRisk(
  draft: DraftSignal,
  opts: { priorAvgRetries?: number } = {},
): RetryRisk {
  const vagueness = severity(draft.wasteBreakdown, 'vagueness');
  const retryLoop = severity(draft.wasteBreakdown, 'retryLoop');
  const lowScore = Math.max(0, (60 - draft.overallScore) / 60); // 0 once score >= 60

  let risk = Math.min(1, 0.6 * vagueness + 0.5 * retryLoop + 0.2 * lowScore);
  const reasons: string[] = [];
  if (vagueness > 0.3) reasons.push('underspecified — no clear target or output format');
  if (retryLoop > 0.3) reasons.push('looks like a re-ask of a previous prompt');

  if (opts.priorAvgRetries != null && opts.priorAvgRetries >= 1) {
    // Personalized prior: similar past prompts of yours needed retries.
    risk = Math.min(1, Math.max(risk, 0.4 + 0.2 * opts.priorAvgRetries));
    reasons.push(`your similar prompts averaged ${opts.priorAvgRetries.toFixed(1)} retries`);
  }

  const level = risk >= 0.6 ? 'high' : risk >= 0.3 ? 'medium' : 'low';
  return { risk, level, reasons };
}

export interface RetryStats {
  count: number;
  avgRetries: number;
}

/**
 * Personalized prior: average retries on past corpus prompts that share a waste
 * category (and, when given, the same model). Returns undefined below a minimum
 * sample so we don't over-fit tiny history.
 */
export function similarRetryStats(
  records: CorpusRecord[],
  categories: string[],
  model?: string,
  minSample = 3,
): RetryStats | undefined {
  if (categories.length === 0) return undefined;
  const cats = new Set(categories);
  const matches = records.filter(
    (r) => (!model || r.model === model) && r.wasteCategories.some((c) => cats.has(c)),
  );
  if (matches.length < minSample) return undefined;
  const avgRetries = matches.reduce((sum, r) => sum + (r.retryCount || 0), 0) / matches.length;
  return { count: matches.length, avgRetries };
}
