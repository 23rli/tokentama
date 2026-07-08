import { useEffect, useState } from 'preact/hooks';
import type { TamaState, HostMessage } from '../../src/webview/contract';
import { post } from './vscodeApi';
import { SustainabilityGauge } from './components/SustainabilityGauge';
import { ForecastPanel } from './components/ForecastPanel';
import { ContextPanel } from './components/ContextPanel';
import { ImpactTrio } from './components/ImpactTrio';
import { LiveData } from './components/LiveData';

export function App() {
  const [state, setState] = useState<TamaState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostMessage>): void => {
      const message = event.data;
      if (message.type === 'state') setState(message.state);
      else if (message.type === 'busy') setBusy(message.busy);
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
        {/* Flat boxes, top → bottom by importance. No nested panels. */}
        <ForecastPanel forecast={state.forecast} />
        <SustainabilityGauge forecast={state.forecast} />
        <ContextPanel
          breakdown={state.forecast?.contextBreakdown ?? state.lastEvent?.contextBreakdown}
          inputTokens={state.forecast?.contextInputTokens ?? state.lastEvent?.inputTokens}
          model={state.model}
        />
        <ImpactTrio metrics={state.metrics} forecast={state.forecast} />
        <LiveData state={state} />
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
