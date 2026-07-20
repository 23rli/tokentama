// Repeatable runner for supported Token Lens research/validation scripts. Bundles
// a scripts/*.ts entry with the same internal aliases as the extension, executes
// it, and removes the temporary bundle afterward.
import esbuild from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const entry = process.argv[2];
if (!entry) throw new Error('Pass a benchmark entry filename from scripts/.');

const alias = {
  '@tokentama/shared-types': path.join(root, 'src/types/index.ts'),
  '@tokentama/scoring-engine': path.join(root, 'src/scoring/index.ts'),
  '@tokentama/ingestion': path.join(root, 'src/capture/parsers/index.ts'),
};

const tempDir = mkdtempSync(path.join(tmpdir(), 'tokenlens-bench-'));
const outfile = path.join(tempDir, `${entry.replace(/\.ts$/, '')}.cjs`);
try {
  await esbuild.build({
    entryPoints: [path.join(here, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    alias,
    outfile,
    logLevel: 'warning',
  });
  await import(pathToFileURL(outfile).href);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
