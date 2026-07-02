import type { ScoredEventView } from '../../../src/webview/contract';

/**
 * A compact strip of the last few scored prompts (newest first) so a prompt —
 * especially the first of a session — doesn't vanish when the next one lands.
 * Hover a chip to see the prompt; the score colours it.
 */
export function RecentStrip({ events }: { events?: ScoredEventView[] }) {
  const list = events ?? [];
  if (list.length < 2) return null;
  return (
    <div class="recent" title="Recent prompts (newest first)">
      {list.map((e, i) => {
        const s = Math.round(e.overallScore);
        const cls = s >= 60 ? 'high' : s >= 30 ? 'mid' : 'low';
        return (
          <span key={i} class={`recent-chip recent-${cls}`} title={e.promptPreview}>
            {s}
          </span>
        );
      })}
    </div>
  );
}
