import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const r = (p) => resolve(__dirname, p);

export default defineConfig({
  resolve: {
    alias: {
      '@tokentama/shared-types': r('src/types/index.ts'),
      '@tokentama/scoring-engine': r('src/scoring/index.ts'),
      '@tokentama/ingestion': r('src/capture/parsers/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'webview-ui/src/**/*.test.{ts,tsx}'],
  },
});
