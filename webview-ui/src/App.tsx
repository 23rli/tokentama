import { useEffect, useState } from 'preact/hooks';
import type { AutoRewriteView, ComposeResult, TamaState, HostMessage } from '../../src/webview/contract';
import { post } from './vscodeApi';
import { PetStage } from './components/PetStage';
import { ScoreHeader } from './components/ScoreHeader';
import { RecentStrip } from './components/RecentStrip';
import { ComposeBox } from './components/ComposeBox';
import { ImpactTrio } from './components/ImpactTrio';
import { LiveData } from './components/LiveData';
import { ContextPanel } from './components/ContextPanel';
import { RightSizePanel } from './components/RightSizePanel';
import { OutcomesPanel } from './components/OutcomesPanel';
import { QualityBars } from './components/QualityBars';
import { CoachingPanel } from './components/CoachingPanel';

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
        <PetStage world={state.world} score={state.overallScore} />
        <ScoreHeader state={state} />
        <RecentStrip events={state.recentEvents} />
        <ComposeBox result={compose} auto={auto} />
        <ImpactTrio metrics={state.metrics} />
        <ContextPanel lastEvent={state.lastEvent} model={state.model} />
        <OutcomesPanel outcomes={state.outcomes} />
        <CoachingPanel tip={state.tip} lastEvent={state.lastEvent} />
        <details class="insights">
          <summary>More insights</summary>
          <div class="insights-body">
            <LiveData state={state} />
            <RightSizePanel lastEvent={state.lastEvent} model={state.model} />
            <QualityBars lastEvent={state.lastEvent} />
          </div>
        </details>
      </div>

      <div class="actions">
        <button class="primary" disabled={busy} onClick={() => post({ type: 'scorePrompt' })}>
          Score a prompt
        </button>
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
