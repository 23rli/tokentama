import { leanRewrite } from '@tokentama/llm-adapters';

/**
 * Build a compact recap of a session's user prompts, suitable for pasting into a
 * fresh chat. Compaction that Tokentama can actually perform: the recap preserves
 * *what was asked* at a fraction of the tokens of the full history, so the user
 * can start a lean chat without losing the thread. Deterministic and offline.
 */
export function buildSessionSummary(prompts: string[], max = 12): string {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const p of prompts) {
    if (!p.trim()) continue;
    const lean = leanRewrite(p);
    const key = lean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(lean);
  }
  const recent = cleaned.slice(-max);
  if (recent.length === 0) return 'Continue the previous task.';
  return (
    "Context recap — what I've asked so far (continue from here; don't restate):\n" +
    recent.map((c, i) => `${i + 1}. ${c}`).join('\n')
  );
}
