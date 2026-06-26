import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/** Map the legacy workspace package names to the flattened src/ locations. */
const alias = {
  '@tokentama/shared-types': path.join(root, 'src/types/index.ts'),
  '@tokentama/scoring-engine': path.join(root, 'src/scoring/index.ts'),
  '@tokentama/llm-adapters': path.join(root, 'src/coaching/index.ts'),
  '@tokentama/ingestion': path.join(root, 'src/capture/parsers/index.ts'),
};

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  alias,
  logLevel: 'info',
};

/** Extension host (Node, CommonJS). `vscode` is provided by the runtime. */
const hostConfig = {
  ...shared,
  entryPoints: [path.join(root, 'src/extension.ts')],
  outfile: path.join(root, 'dist/extension.js'),
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
};

/** Webview (browser, Preact). Emits dist/webview.js + dist/webview.css. */
const webviewConfig = {
  ...shared,
  entryPoints: [path.join(root, 'webview-ui/src/main.tsx')],
  outfile: path.join(root, 'dist/webview.js'),
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.css': 'css', '.svg': 'text' },
};

async function run() {
  if (watch) {
    const hostCtx = await esbuild.context(hostConfig);
    const webviewCtx = await esbuild.context(webviewConfig);
    await Promise.all([hostCtx.watch(), webviewCtx.watch()]);
    console.log('[esbuild] watching for changes...');
  } else {
    await Promise.all([esbuild.build(hostConfig), esbuild.build(webviewConfig)]);
    console.log('[esbuild] build complete');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
