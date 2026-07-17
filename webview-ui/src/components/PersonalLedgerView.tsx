import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type {
  LedgerBreakdownRow,
  LedgerTimeRange,
  MeteringCoverageCounts,
  PersonalLedgerOverview,
  PersonalLedgerScopeSummary,
  UsageMeteringStatus,
} from '../../../src/webview/contract';
import { fmtNum, fmtUsd } from '../format';
import { post } from '../vscodeApi';

const RANGES: { key: LedgerTimeRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'All' },
];

export function PersonalLedgerView({
  overview,
  busy,
}: {
  overview?: PersonalLedgerOverview;
  busy: boolean;
}) {
  const [range, setRange] = useState<LedgerTimeRange>('30d');
  const rangeRefs = useRef<Array<HTMLButtonElement | null>>([]);
  if (!overview?.ready) {
    return (
      <section class="card ledger-empty muted">
        Initializing the local metadata ledger…
      </section>
    );
  }

  const summary = overview.scopes[range];
  const sourceReady = overview.sources.some((source) => source.status === 'ready');
  const rangeIndex = RANGES.findIndex((item) => item.key === range);
  const selectRange = (index: number): void => {
    const normalized = (index + RANGES.length) % RANGES.length;
    setRange(RANGES[normalized].key);
    requestAnimationFrame(() => rangeRefs.current[normalized]?.focus());
  };
  const onRangeKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowLeft') selectRange(rangeIndex - 1);
    else if (event.key === 'ArrowRight') selectRange(rangeIndex + 1);
    else if (event.key === 'Home') selectRange(0);
    else if (event.key === 'End') selectRange(RANGES.length - 1);
    else return;
    event.preventDefault();
  };
  return (
    <div class="ledger-view">
      <section class="card ledger-hero">
        <div class="ledger-head">
          <div>
            <div class="section-title" role="heading" aria-level={2}>Personal AI usage</div>
            <div class="ledger-sub">Private metadata ledger on this machine</div>
          </div>
          <div class="ledger-head-actions">
            <span class={`ledger-health${sourceReady ? ' ready' : ''}`}>
              {sourceReady ? 'synced' : overview.sources[0]?.status ?? 'local'}
            </span>
            <button
              class="ledger-export"
              disabled={busy || overview.diagnostics.recordCount === 0}
              title="Export all retained metadata-only records as JSON or CSV"
              onClick={() => post({ type: 'exportLedger' })}
            >
              Export all
            </button>
          </div>
        </div>
        <div class="ledger-ranges" role="tablist" aria-label="Personal ledger time range">
          {RANGES.map((item, index) => (
            <button
              key={item.key}
              ref={(element) => { rangeRefs.current[index] = element; }}
              id={`ledger-range-${item.key}`}
              role="tab"
              aria-selected={range === item.key}
              aria-controls="ledger-summary-panel"
              tabIndex={range === item.key ? 0 : -1}
              class={`ledger-range${range === item.key ? ' active' : ''}`}
              onClick={() => setRange(item.key)}
              onKeyDown={onRangeKeyDown}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div
          id="ledger-summary-panel"
          role="tabpanel"
          aria-labelledby={`ledger-range-${range}`}
        >
          {summary.records === 0 ? (
            <p class="ledger-zero muted">
              No durable usage observations in this range. Send a Copilot Chat request and let it finish.
            </p>
          ) : (
            <LedgerTotals summary={summary} />
          )}
        </div>
      </section>

      <CoverageCard summary={summary} />

      {summary.records > 0 && (
        <>
          <BreakdownCard title="Applications" rows={summary.byApplication} />
          {summary.byProvider.length > 1 && (
            <BreakdownCard title="Providers" rows={summary.byProvider} />
          )}
          <BreakdownCard title="Models" rows={summary.byModel} />
          <BreakdownCard title="Projects" rows={summary.byProject} />
        </>
      )}

      <section class="card ledger-sources">
        <div class="ledger-section-head">
          <span class="section-title" role="heading" aria-level={2}>Sources</span>
          <span class="ledger-muted">local only</span>
        </div>
        {overview.sources.map((source) => (
          <div class="ledger-source" key={source.adapterId}>
            <div>
              <strong>{source.applicationName}</strong>
              <span>{source.detail ?? source.status}</span>
            </div>
            <div class="ledger-source-meta">
              <span>{source.sessionCount} chats</span>
              <span>{source.capabilities.tokens ? 'tokens' : 'no tokens'}</span>
              <span>{source.capabilities.perToolTokens ? 'per-tool meter' : 'no per-tool meter'}</span>
            </div>
          </div>
        ))}
      </section>

      {overview.recent.length > 0 && (
        <details class="card ledger-recent">
          <summary class="ledger-section-head">
            <span class="section-title" role="heading" aria-level={2}>Recent activity</span>
            <span class="ledger-muted">all chats · metadata only</span>
          </summary>
          <div class="ledger-recent-list">
            {overview.recent.slice(0, 8).map((row) => (
              <div class="ledger-recent-row" key={row.sourceRecordId}>
                <div class="ledger-recent-main">
                  <strong>{row.applicationName}</strong>
                  <span>{row.projectName} · {row.workflowName ?? row.modelName}</span>
                </div>
                <div class="ledger-recent-value">
                  <strong>{row.meteringStatus === 'pending' || row.meteringStatus === 'unavailable' ? '—' : fmtNum(row.tokens)}</strong>
                  <span>{meteringLabel(row.meteringStatus)} · {formatWhen(row.occurredAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      <section class="card ledger-foot">
        <div>
          <strong>{fmtNum(overview.diagnostics.recordCount)}</strong>
          <span>records</span>
        </div>
        <div>
          <strong>{formatBytes(overview.diagnostics.storageBytes)}</strong>
          <span>local storage</span>
        </div>
        <div>
          <strong>{overview.diagnostics.retention === 'until-cleared' ? 'Manual' : 'Policy'}</strong>
          <span>retention</span>
        </div>
        {(overview.diagnostics.malformedLines > 0 || overview.diagnostics.conflictingRecords > 0) && (
          <p class="ledger-warning">
            {overview.diagnostics.malformedLines} malformed lines · {overview.diagnostics.conflictingRecords} conflicts
          </p>
        )}
      </section>
    </div>
  );
}

function LedgerTotals({ summary }: { summary: PersonalLedgerScopeSummary }) {
  const cost = summary.costUsd == null
    ? '—'
    : fmtUsd(summary.costUsd);
  return (
    <div class="ledger-totals">
      <div>
        <strong>{fmtNum(summary.totalTokens)}</strong>
        <span>{summary.tokensPartial ? 'Measured tokens' : 'Tokens'}</span>
      </div>
      <div>
        <strong>{fmtNum(summary.nativeCredits)}</strong>
        <span>{summary.creditsEstimated ? 'AICs (mixed)' : 'Copilot AICs'}</span>
      </div>
      <div>
        <strong>{cost}</strong>
        <span>{summary.costPartial ? 'Known cost' : summary.costBasis === 'tokens' ? 'Token-rate cost' : summary.costBasis === 'copilot-aic' ? 'AIC-rate cost' : 'Cost not set'}</span>
      </div>
    </div>
  );
}

function CoverageCard({ summary }: { summary: PersonalLedgerScopeSummary }) {
  const measured = summary.records > 0
    ? Math.round((summary.fullyMeteredRecords / summary.records) * 100)
    : 0;
  return (
    <section class="card ledger-coverage">
      <div class="ledger-section-head">
        <span class="section-title" role="heading" aria-level={2}>Data coverage</span>
        <strong>{measured}% fully metered</strong>
      </div>
      <div class="ledger-coverage-track" aria-label={`${measured} percent fully metered`}>
        <span style={{ width: `${measured}%` }} />
      </div>
      <div class="ledger-coverage-meta">
        <span>{summary.fullyMeteredRecords} full</span>
        {summary.inputOnlyRecords > 0 && <span>{summary.inputOnlyRecords} input measured</span>}
        {summary.outputOnlyRecords > 0 && <span>{summary.outputOnlyRecords} output measured</span>}
        {summary.pendingRecords > 0 && <span>{summary.pendingRecords} in flight</span>}
        {summary.unavailableRecords > 0 && <span>{summary.unavailableRecords} usage unavailable</span>}
      </div>
      <p class="ledger-note">
        Totals sum only measured directions. Missing source meters are listed above, not presented as pending.
      </p>
    </section>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: LedgerBreakdownRow[] }) {
  const max = Math.max(1, ...rows.map((row) => row.tokens));
  return (
    <section class="card ledger-breakdown">
      <div class="ledger-section-head">
        <span class="section-title" role="heading" aria-level={2}>{title}</span>
        <span class="ledger-muted">by known tokens</span>
      </div>
      <div class="ledger-breakdown-list">
        {rows.slice(0, 6).map((row) => (
          <div class="ledger-breakdown-row" key={row.id}>
            <div class="ledger-breakdown-label">
              <span title={row.name}>{row.name}</span>
              <strong>{fmtNum(row.tokens)}</strong>
            </div>
            <div class="ledger-breakdown-track">
              <span style={{ width: `${Math.max(1, (row.tokens / max) * 100)}%` }} />
            </div>
            <div class="ledger-breakdown-meta">
              <span>{row.records} turn{row.records === 1 ? '' : 's'}</span>
              <span>{coverageLabel(row.coverage)}</span>
              {row.costUsd != null && <span>{fmtUsd(row.costUsd)}{row.costPartial ? ' known' : ''}</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function meteringLabel(status: UsageMeteringStatus): string {
  switch (status) {
    case 'metered': return 'fully metered';
    case 'input-only': return 'input measured';
    case 'output-only': return 'output measured';
    case 'pending': return 'in flight';
    case 'unavailable': return 'usage unavailable';
  }
}

function coverageLabel(coverage: MeteringCoverageCounts): string {
  const gaps = coverage.inputOnly + coverage.outputOnly + coverage.pending + coverage.unavailable;
  if (gaps === 0) return 'fully metered';
  const parts: string[] = [];
  if (coverage.inputOnly) parts.push(`${coverage.inputOnly} input-only`);
  if (coverage.outputOnly) parts.push(`${coverage.outputOnly} output-only`);
  if (coverage.pending) parts.push(`${coverage.pending} in flight`);
  if (coverage.unavailable) parts.push(`${coverage.unavailable} unavailable`);
  return parts.join(' · ');
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown time';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
