import { useEffect, useRef, useState } from 'preact/hooks';
import type { PetWorldState } from '../../../src/webview/contract';

/** Healthiest -> most degraded. Higher index = worse. */
const RANK: Record<PetWorldState, number> = {
  thriving: 0,
  healthy: 1,
  concerned: 2,
  critical: 3,
  collapse: 4,
  dead: 5,
};

interface Visual {
  label: string;
  caption: string;
  /** Clippy sprite (from media/clippy). */
  sprite: 'yellow_run_8fps' | 'yellow_walk_fast_8fps' | 'yellow_walk_8fps' | 'yellow_idle_8fps';
  /** Seconds for one full back-and-forth lap. Lower = faster. */
  lap: number;
  /** False once Clippy has collapsed — it stops moving and falls over. */
  alive: boolean;
}

const VISUALS: Record<PetWorldState, Visual> = {
  thriving: {
    label: 'Thriving',
    caption: 'Flourishing — Clippy is sprinting with clean, efficient prompts!',
    sprite: 'yellow_run_8fps',
    lap: 3,
    alive: true,
  },
  healthy: {
    label: 'Healthy',
    caption: 'Green and steady. Clippy keeps a brisk pace.',
    sprite: 'yellow_walk_fast_8fps',
    lap: 5,
    alive: true,
  },
  concerned: {
    label: 'Concerned',
    caption: 'Waste is creeping in — Clippy is slowing down.',
    sprite: 'yellow_walk_8fps',
    lap: 8,
    alive: true,
  },
  critical: {
    label: 'Critical',
    caption: 'Struggling. Clippy can barely shuffle along.',
    sprite: 'yellow_walk_8fps',
    lap: 13,
    alive: true,
  },
  collapse: {
    label: 'Collapse',
    caption: 'Heavy waste. Clippy has collapsed — refactor your prompts.',
    sprite: 'yellow_idle_8fps',
    lap: 0,
    alive: false,
  },
  dead: {
    label: 'Dormant',
    caption: 'Dormant. Score a clean prompt to revive Clippy.',
    sprite: 'yellow_idle_8fps',
    lap: 0,
    alive: false,
  },
};

function spriteUrl(name: Visual['sprite']): string {
  const base = window.__TOKENTAMA_MEDIA__ ?? 'media';
  return `${base}/clippy/${name}.gif`;
}

export function PetStage({ world, score }: { world: PetWorldState; score: number }) {
  const v = VISUALS[world];
  // 0..1 fullness drives the whole landscape: the lake recedes, the dry bed shows
  // through, and the greenery withers as the score falls — a drought, not a bar.
  const fill = Math.max(0, Math.min(1, score / 100));
  const prevWorld = useRef<PetWorldState>(world);
  // 'hit' = a normal damage flinch; 'death' = the extra-dramatic final blow.
  const [hit, setHit] = useState<null | 'hit' | 'death'>(null);

  useEffect(() => {
    const prev = prevWorld.current;
    prevWorld.current = world;
    if (RANK[world] <= RANK[prev]) return; // unchanged or recovering — no drama
    const kind = world === 'dead' ? 'death' : 'hit';
    setHit(kind);
    const ms = kind === 'death' ? 1400 : 700;
    const timer = window.setTimeout(() => setHit(null), ms);
    return () => window.clearTimeout(timer);
  }, [world]);

  const sceneClass =
    `petstage-scene scene-${world}` +
    (hit ? ` petstage-scene--${hit}` : '');

  const sceneStyle = `--fill:${fill}${v.alive ? `;--lap:${v.lap}s` : ''}`;

  return (
    <div class="petstage">
      <div
        class={sceneClass}
        style={sceneStyle}
        role="img"
        aria-label={`Tokentama ${v.label}`}
      >
        <div class="scene-stars" />
        <div class="scene-sun" />
        <div class="scene-haze" />
        <div class="scene-flash" />
        <div class="scene-mountains" />
        <div class="scene-scenery">
          <div class="scene-trees" />
          <div class="scene-grass" />
        </div>
        <div class="scene-riverbed" />
        <div class="scene-river" />
        <div class="scene-ground" />
        <div class="scene-plants" />

        <div
          class={
            `clippy-walker${v.alive ? '' : ' clippy-walker--down'}` +
            (hit ? ` clippy-walker--${hit}` : '')
          }
        >
          <img class="clippy-sprite" src={spriteUrl(v.sprite)} alt="" draggable={false} />
        </div>
      </div>

      <div class="petstage-caption">
        <span class={`world-chip world-${world}`}>{v.label}</span>
        <span class="petstage-sub">{v.caption}</span>
      </div>
    </div>
  );
}
