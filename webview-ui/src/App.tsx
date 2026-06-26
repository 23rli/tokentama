import { useEffect, useState } from 'preact/hooks';
import type { GuardianState, HostMessage } from '../../src/webview/contract';
import { post } from './vscodeApi';
import { PetStage } from './components/PetStage';
import { ScoreHeader } from './components/ScoreHeader';
import { ImpactTrio } from './components/ImpactTrio';
import { LiveData } from './components/LiveData';
import { QualityBars } from './components/QualityBars';
import { CoachingPanel } from './components/CoachingPanel';

export function App() {
  const [state, setState] = useState<GuardianState | null>(null);
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
    return <div class="loading">Summoning your guardian…</div>;
  }

  return (
    <div class="app">
      <div class="app-main">
        <PetStage world={state.world} score={state.overallScore} />
        <ScoreHeader state={state} />
        <ImpactTrio metrics={state.metrics} />
        <LiveData state={state} />
        <QualityBars lastEvent={state.lastEvent} />
        <CoachingPanel tip={state.tip} lastEvent={state.lastEvent} />
      </div>

      <div class="actions">
        <button class="primary" disabled={busy} onClick={() => post({ type: 'scorePrompt' })}>
          Score a prompt
        </button>
        <button class="ghost" disabled={busy} onClick={() => post({ type: 'runDemo' })}>
          {busy ? '▶ Running…' : '▶ Demo'}
        </button>
        <button class="ghost" disabled={busy} onClick={() => post({ type: 'toggleCapture' })}>
          {state.captureEnabled ? '◉ Capture' : '○ Capture'}
        </button>
        <button class="ghost" disabled={busy} onClick={() => post({ type: 'reset' })}>
          Reset
        </button>
      </div>
    </div>
  );
}
