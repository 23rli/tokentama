import { useEffect, useState } from 'preact/hooks';
import type { GuardianState, HostMessage } from '../../src/webview/contract';
import { post } from './vscodeApi';
import { PetStage } from './components/PetStage';
import { ScoreHeader } from './components/ScoreHeader';
import { ModelCard } from './components/ModelCard';
import { MetricsGrid } from './components/MetricsGrid';
import { WasteBreakdown } from './components/WasteBreakdown';
import { CoachingPanel } from './components/CoachingPanel';

export function App() {
  const [state, setState] = useState<GuardianState | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostMessage>): void => {
      const message = event.data;
      if (message.type === 'state') setState(message.state);
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
      <PetStage world={state.world} />
      <ScoreHeader state={state} />
      <ModelCard model={state.model} />

      <div class="actions">
        <button class="primary" onClick={() => post({ type: 'scorePrompt' })}>
          Score a prompt
        </button>
        <button class="ghost" onClick={() => post({ type: 'toggleCapture' })}>
          {state.captureEnabled ? '◉ Capture on' : '○ Capture off'}
        </button>
        <button class="ghost" onClick={() => post({ type: 'reset' })}>
          Reset
        </button>
      </div>

      <CoachingPanel tip={state.tip} lastEvent={state.lastEvent} />
      <MetricsGrid metrics={state.metrics} />
      <WasteBreakdown lastEvent={state.lastEvent} />
    </div>
  );
}
