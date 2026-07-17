import type {
  MaterializedUsageRecord,
  PersonalLedgerOverview,
} from '@tokentama/shared-types';

export interface LedgerJsonExport {
  exportSchemaVersion: 1;
  kind: 'token-lens-local-usage-ledger';
  generatedAt: string;
  privacy: {
    metadataOnly: true;
    excludes: string[];
  };
  coverage: PersonalLedgerOverview['diagnostics'];
  sources: PersonalLedgerOverview['sources'];
  records: MaterializedUsageRecord[];
}

export function buildLedgerJsonExport(
  records: readonly MaterializedUsageRecord[],
  overview: PersonalLedgerOverview,
): LedgerJsonExport {
  return {
    exportSchemaVersion: 1,
    kind: 'token-lens-local-usage-ledger',
    generatedAt: new Date().toISOString(),
    privacy: {
      metadataOnly: true,
      excludes: [
        'prompt text',
        'assistant responses',
        'code and document content',
        'tool arguments',
        'raw workspace paths',
        'user and machine identifiers',
      ],
    },
    coverage: overview.diagnostics,
    sources: overview.sources,
    records: [...records],
  };
}

export function buildLedgerCsvExport(records: readonly MaterializedUsageRecord[]): string {
  const columns = [
    'occurred_at',
    'application',
    'provider',
    'project',
    'model',
    'interaction_type',
    'workflow',
    'metering_status',
    'input_tokens_metered',
    'output_tokens_metered',
    'known_tokens',
    'tokens_partial',
    'native_charge_unit',
    'native_charge_value',
    'native_charge_provenance',
    'tool_calls',
    'mcp_calls',
    'revisions',
    'conflicts',
  ];
  const rows = records.map((record) => {
    const charge = record.charges[0];
    const workflow = record.evidence.find((item) =>
      item.confidence === 'high' && item.kind !== 'tool',
    );
    return [
      record.occurredAt,
      record.source.applicationName,
      record.source.providerName,
      record.project.name ?? `Project ${record.project.key.slice(0, 8)}`,
      record.model?.name ?? record.model?.id ?? 'Unknown model',
      record.interaction.type,
      workflow?.value ?? '',
      record.usage.status ?? 'unavailable',
      record.usage.input.provenance === 'metered' ? record.usage.input.value : '',
      record.usage.output.provenance === 'metered' ? record.usage.output.value : '',
      record.usage.knownTotal,
      record.usage.partial,
      charge?.unit ?? '',
      charge?.value ?? '',
      charge?.provenance ?? '',
      record.tools.length,
      record.tools.filter((tool) => tool.kind === 'mcp').length,
      record.revisionCount,
      record.conflictFields.join('|'),
    ];
  });
  return `\uFEFF${[columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}