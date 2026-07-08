import { useEffect, useState } from 'preact/hooks';
import type { AutoRewriteView, ComposeResult, TamaState, HostMessage } from '../../src/webview/contract';
import { post } from './vscodeApi';
import { SustainabilityGauge } from './components/SustainabilityGauge';
import { ForecastPanel } from './components/ForecastPanel';
import { ContextPanel } from './components/ContextPanel';
import { ImpactTrio } from './components/ImpactTrio';
import { LiveData } from './components/LiveData';
import { RecentStrip } from './components/RecentStrip';
import { ComposeBox } from './components/ComposeBox';
import { ScoreHeader } from './components/ScoreHeader';
import { QualityBars } from './components/QualityBars';

export function App() {
  const [state, setState] = useState<TamaState | null>(null);
  const [busy, setBusy] = useState(false);
  const [compose, setCompose] = useState<ComposeResult | undefined>(undefined);
  const [auto, setAuto] = useState<AutoRewriteView | undefined>(undefined);

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostMessage>): void => {
      const message = event.data;
      if (message.type === 'state') setState(message.state);
      else if (message.type === 'busy') setBusy(message.busy);
      else if (message.type === 'composeResult') setCompose(message.result);
      else if (message.type === 'autoRewriteResult') setAuto(message.result);
    };
    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (!state) {
    return <div class="loading">Summoning Tokentama…</div>;
  }

  return (
    <div class="app">
      <div class="app-main">
        {/* 1 — Hero: where are we (session + last prompt) + next-turn forecast vs real. */}
        <ForecastPanel forecast={state.forecast} />

        {/* 2 — Context weight: how heavy the session is + per-turn growth graph. */}
        <SustainabilityGauge forecast={state.forecast} />

        {/* 3 — Where the tokens go — always visible (the real cost driver). */}
        <ContextPanel lastEvent={state.lastEvent} model={state.model} />

        {/* 4 — Live cost this session (tokens / credits / $). */}
        <ImpactTrio metrics={state.metrics} />

        {/* 5 — Live Copilot capture data. */}
        <LiveData state={state} />

        {/* 6 — Recent turns. */}
        <RecentStrip events={state.recentEvents} />

        {/* 7 — Compose & predict a prompt — minimizable, at the end, with the
            low-priority insights folded in alongside it. */}
        <details class="compose-fold">
          <summary>✍️ Compose &amp; predict · more insights</summary>
          <div class="compose-fold-body">
            <ComposeBox result={compose} auto={auto} />
            <div class="insights-body">
              <ScoreHeader state={state} />
              <QualityBars lastEvent={state.lastEvent} />
            </div>
          </div>
        </details>
      </div>

      <div class="actions">
        <button class="ghost" disabled={busy} onClick={() => post({ type: 'toggleCapture' })}>
          {state.captureEnabled ? '◉ Capture on' : '○ Capture off'}
        </button>
        <button class="ghost" disabled={busy} onClick={() => post({ type: 'reset' })}>
          Reset
        </button>
      </div>
    </div>
  );
}
