import type { UsageObservation, UsageSourceHealth } from '@tokentama/shared-types';

export interface SourceAdapterCapabilities {
  tokens: boolean;
  nativeCharges: boolean;
  tools: boolean;
  perToolTokens: boolean;
}

export interface SourceScanResult {
  observations: UsageObservation[];
  health: UsageSourceHealth;
}

/** Contract future local AI applications implement without changing the ledger. */
export interface SourceAdapter<TInput = void> {
  readonly id: string;
  readonly applicationId: string;
  readonly applicationName: string;
  readonly capabilities: SourceAdapterCapabilities;
  scan(input: TInput): Promise<SourceScanResult>;
}