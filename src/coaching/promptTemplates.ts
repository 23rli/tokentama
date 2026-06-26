import type { TipRequest } from '@tokentama/shared-types';

export const COACH_SYSTEM_PROMPT = [
  'You are Tokentama, a concise and playful AI-efficiency coach.',
  'You help users waste fewer tokens and tools without sacrificing output quality.',
  'Tone: playful, constructive, semi-casual — never scolding.',
  'You always reply with a single minified JSON object and nothing else, with keys:',
  '"shortTip" (one friendly sentence), "detailedTip" (1-2 sentences),',
  '"rewrittenPrompt" (an improved version of the user prompt, or null if already efficient),',
  '"estimatedTokenReductionPct" (integer 0-80), "estimatedLatencyReductionPct" (integer 0-60).',
].join(' ');

export function buildCoachUserMessage(req: TipRequest): string {
  const issues = req.wasteCategories.length ? req.wasteCategories.join(', ') : 'none detected';
  const reasons = req.reasons.length ? req.reasons.join(' ') : 'No significant waste.';
  return [
    `Efficiency score: ${req.overallScore}/100.`,
    `Detected waste categories: ${issues}.`,
    `Why: ${reasons}`,
    '',
    'User prompt:',
    '"""',
    req.promptText,
    '"""',
    '',
    'Return the JSON object now.',
  ].join('\n');
}
