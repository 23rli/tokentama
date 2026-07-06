// Repeatable runner for the token-savings benchmark. Bundles scripts/bench.ts with
// the same @tokentama/* aliases esbuild uses, then executes it. Run: `npm run bench`.
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const alias = {
  '@tokentama/shared-types': path.join(root, 'src/types/index.ts'),
  '@tokentama/scoring-engine': path.join(root, 'src/scoring/index.ts'),
  '@tokentama/llm-adapters': path.join(root, 'src/coaching/index.ts'),
  '@tokentama/ingestion': path.join(root, 'src/capture/parsers/index.ts'),
};

const outfile = path.join(here, '.bench.cjs');
await esbuild.build({
  entryPoints: [path.join(here, 'bench.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  alias,
  outfile,
  logLevel: 'warning',
});
await import(pathToFileURL(outfile).href);
