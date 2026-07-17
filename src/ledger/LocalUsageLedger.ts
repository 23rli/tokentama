import { randomUUID } from 'node:crypto';
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
} from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type {
  LocalLedgerDiagnostics,
  MaterializedUsageRecord,
  UsageObservation,
} from '@tokentama/shared-types';
import { materializeUsageObservations } from './materialize';
import { isUsageObservation } from './validate';

export interface LedgerAppendResult {
  requested: number;
  appended: number;
  duplicatesSkipped: number;
}

interface LedgerReadResult {
  observations: UsageObservation[];
  fileCount: number;
  storageBytes: number;
  malformedLines: number;
  malformedFiles: string[];
}

/** Dependency-free append-only local metadata ledger. */
export class LocalUsageLedger {
  private readonly writerId = randomUUID();
  private readonly knownObservationIds = new Set<string>();
  private initPromise?: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly root: string) {}

  get storageRoot(): string {
    return this.root;
  }

  initialize(): Promise<void> {
    this.initPromise ??= this.loadKnownIds();
    return this.initPromise;
  }

  async append(observations: readonly UsageObservation[]): Promise<LedgerAppendResult> {
    await this.initialize();
    const unique = new Map<string, UsageObservation>();
    for (const observation of observations) {
      if (isUsageObservation(observation)) unique.set(observation.observationId, observation);
    }
    let result: LedgerAppendResult | undefined;
    const operation = this.writeQueue.then(async () => {
      const pending = [...unique.values()].filter(
        (observation) => !this.knownObservationIds.has(observation.observationId),
      );
      await this.appendInternal(pending);
      result = {
        requested: observations.length,
        appended: pending.length,
        duplicatesSkipped: observations.length - pending.length,
      };
    });
    this.writeQueue = operation;
    await operation;
    return result!;
  }

  async materialize(): Promise<{
    records: MaterializedUsageRecord[];
    diagnostics: LocalLedgerDiagnostics;
  }> {
    await this.initialize();
    await this.writeQueue;
    const read = await this.readAll();
    const materialized = materializeUsageObservations(read.observations);
    const records = materialized.records;
    return {
      records,
      diagnostics: {
        schemaVersion: 1,
        observationCount: materialized.uniqueObservationCount,
        recordCount: records.length,
        fileCount: read.fileCount,
        storageBytes: read.storageBytes,
        malformedLines: read.malformedLines,
        malformedFiles: read.malformedFiles,
        duplicateObservations: materialized.duplicateObservations,
        conflictingRecords: records.filter((record) => record.conflictFields.length > 0).length,
        oldestAt: records.length ? records.map((record) => record.occurredAt).sort()[0] : undefined,
        newestAt: records.length ? records.map((record) => record.occurredAt).sort().at(-1) : undefined,
        retention: 'until-cleared',
      },
    };
  }

  async clear(): Promise<void> {
    await this.writeQueue;
    await rm(this.root, { recursive: true, force: true });
    this.knownObservationIds.clear();
    this.initPromise = undefined;
  }

  private async loadKnownIds(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const read = await this.readAll();
    for (const observation of read.observations) {
      this.knownObservationIds.add(observation.observationId);
    }
  }

  private async appendInternal(observations: UsageObservation[]): Promise<void> {
    if (observations.length === 0) return;
    const byFile = new Map<string, UsageObservation[]>();
    for (const observation of observations) {
      const month = /^\d{4}-\d{2}/.exec(observation.occurredAt)?.[0] ?? 'unknown';
      const adapter = safeSegment(observation.source.adapterId);
      const file = join(this.root, 'writers', this.writerId, adapter, `${month}.jsonl`);
      const rows = byFile.get(file) ?? [];
      rows.push(observation);
      byFile.set(file, rows);
    }
    for (const [file, rows] of byFile) {
      await mkdir(dirname(file), { recursive: true });
      await appendFile(file, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
      for (const row of rows) this.knownObservationIds.add(row.observationId);
    }
  }

  private async readAll(): Promise<LedgerReadResult> {
    const files = await listJsonlFiles(this.root);
    const observations: UsageObservation[] = [];
    let malformedLines = 0;
    const malformedFiles = new Set<string>();
    let storageBytes = 0;
    for (const file of files) {
      try {
        const [content, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
        storageBytes += info.size;
        for (const line of content.split(/\r?\n/)) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as unknown;
            if (isUsageObservation(parsed)) observations.push(parsed);
            else {
              malformedLines += 1;
              malformedFiles.add(relative(this.root, file));
            }
          } catch {
            malformedLines += 1;
            malformedFiles.add(relative(this.root, file));
          }
        }
      } catch {
        malformedLines += 1;
        malformedFiles.add(relative(this.root, file));
      }
    }
    return {
      observations,
      fileCount: files.length,
      storageBytes,
      malformedLines,
      malformedFiles: [...malformedFiles].sort(),
    };
  }
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await listJsonlFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) result.push(path);
  }
  return result.sort();
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 100) || 'unknown';
}