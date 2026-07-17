import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalUsageLedger } from '../LocalUsageLedger';
import { observation } from './fixtures';

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('LocalUsageLedger', () => {
  it('persists observations, suppresses same-instance duplicates, and survives restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tokenlens-ledger-'));
    tempDirs.push(dir);
    const first = new LocalUsageLedger(dir);
    const row = observation();
    expect(await first.append([row, row])).toEqual({
      requested: 2,
      appended: 1,
      duplicatesSkipped: 1,
    });
    expect((await first.materialize()).records).toHaveLength(1);

    const restarted = new LocalUsageLedger(dir);
    await restarted.initialize();
    expect((await restarted.append([row])).appended).toBe(0);
    const snapshot = await restarted.materialize();
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.diagnostics.observationCount).toBe(1);
    expect(snapshot.diagnostics.retention).toBe('until-cleared');
  });

  it('recovers from a malformed trailing line and clears only ledger storage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tokenlens-ledger-'));
    tempDirs.push(dir);
    const ledger = new LocalUsageLedger(dir);
    await ledger.append([observation()]);
    const files = await findJsonl(dir);
    await appendFile(files[0], '{truncated', 'utf8');
    const snapshot = await ledger.materialize();
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.diagnostics.malformedLines).toBe(1);
    await ledger.clear();
    expect((await ledger.materialize()).records).toEqual([]);
  });

  it('suppresses concurrent same-window duplicate appends', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tokenlens-ledger-'));
    tempDirs.push(dir);
    const ledger = new LocalUsageLedger(dir);
    const row = observation();
    const [first, second] = await Promise.all([ledger.append([row]), ledger.append([row])]);
    expect(first.appended + second.appended).toBe(1);
    expect((await ledger.materialize()).diagnostics.observationCount).toBe(1);
  });

  it('deduplicates independent writer partitions at materialization time', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tokenlens-ledger-'));
    tempDirs.push(dir);
    const first = new LocalUsageLedger(dir);
    const second = new LocalUsageLedger(dir);
    const row = observation();
    await Promise.all([first.append([row]), second.append([row])]);
    const snapshot = await first.materialize();
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.diagnostics.observationCount).toBe(1);
    expect(snapshot.diagnostics.duplicateObservations).toBe(1);
    expect(snapshot.diagnostics.fileCount).toBe(2);
  });

  it('waits for an in-flight append before materializing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tokenlens-ledger-'));
    tempDirs.push(dir);
    const ledger = new LocalUsageLedger(dir);
    const append = ledger.append([observation()]);
    const snapshot = await ledger.materialize();
    await append;
    expect(snapshot.records).toHaveLength(1);
  });
});

async function findJsonl(root: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await findJsonl(path));
    else if (entry.name.endsWith('.jsonl')) result.push(path);
  }
  return result;
}