import { useEffect, useState } from 'preact/hooks';
import type { TamaState, HostMessage } from '../../src/webview/contract';
import { post } from './vscodeApi';
import { SustainabilityGauge } from './components/SustainabilityGauge';
import { ForecastPanel } from './components/ForecastPanel';
import { ContextPanel } from './components/ContextPanel';
import { ImpactTrio } from './components/ImpactTrio';
import { LiveData } from './components/LiveData';
import { HistoryView } from './components/HistoryView';

export function App() {
  const [state, setState] = useState<TamaState | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'dashboard' | 'history'>('dashboard');
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
  const [, tick] = useState(0);

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostMessage>): void => {
      const message = event.data;
      if (message.type === 'state') {
        setState(message.state);
        setLastUpdate(Date.now());
      } else if (message.type === 'busy') setBusy(message.busy);
    };
    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
    // Tick once a second so the "updated Ns ago" indicator stays current.
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      window.removeEventListener('message', onMessage);
      clearInterval(id);
    };
  }, []);

  if (!state) {
    return <div class="loading">Loading Token Lens…</div>;
  }

  const agoSec = Math.max(0, Math.round((Date.now() - lastUpdate) / 1000));

  return (
    <div class="app">
      <div class="tabs">
        <button class={`tab${tab === 'dashboard' ? ' active' : ''}`} onClick={() => setTab('dashboard')}>
          Dashboard
        </button>
        <button class={`tab${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')}>
          History
        </button>
      </div>

      {tab === 'dashboard' ? (
        <div class="app-main">
          <ForecastPanel forecast={state.forecast} />
          <SustainabilityGauge forecast={state.forecast} />
          <ContextPanel
            breakdown={state.forecast?.contextBreakdown}
            inputTokens={state.forecast?.contextInputTokens}
            sessionBreakdown={state.forecast?.sessionBreakdown}
            sessionInputTokens={state.forecast?.sessionInputTokens}
            chatBreakdown={state.forecast?.chatBreakdown}
            chatInputTokens={state.forecast?.chatInputTokens}
            chatSessionCount={state.forecast?.chatSessionCount}
          />
          <ImpactTrio metrics={state.metrics} forecast={state.forecast} />
          <LiveData state={state} />
        </div>
      ) : (
        <div class="app-main">
          <HistoryView forecast={state.forecast} />
        </div>
      )}

      <div class="actions">
        <span class="live" title={`Auto-refreshes from disk. Last update ${agoSec}s ago.`}>
          <span class={`live-dot${agoSec <= 4 ? ' on' : ' stale'}`} />
          {agoSec <= 4 ? 'live' : `updated ${agoSec}s ago`}
        </span>
        <button class="ghost" disabled={busy} onClick={() => post({ type: 'toggleCapture' })}>
          {state.captureEnabled ? '◉ Capture on' : '○ Capture off'}
        </button>
      </div>
    </div>
  );
}
