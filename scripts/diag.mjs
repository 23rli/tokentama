// Diagnostic: run the real capture pipeline against the live Copilot files.
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const alias = {
  '@ecoprompt/shared-types': path.join(repo, 'src/types/index.ts'),
  '@ecoprompt/scoring-engine': path.join(repo, 'src/scoring/index.ts'),
  '@ecoprompt/llm-adapters': path.join(repo, 'src/coaching/index.ts'),
  '@ecoprompt/ingestion': path.join(repo, 'src/capture/parsers/index.ts'),
};

const out = path.join(repo, 'dist/diag.cjs');
await esbuild.build({
  stdin: {
    contents: `
      import { listCopilotSessions, findActiveSession } from './src/capture/copilotPaths';
      import { readSessionEvents } from './src/capture/copilotReader';
      const sessions = listCopilotSessions();
      console.log('sessions found:', sessions.length);
      for (const s of sessions.slice(0, 6)) {
        console.log('  ' + s.sessionId + '  hash=' + s.workspaceHash + '  mtime=' + new Date(s.modifiedMs).toISOString() + '  chat=' + !!s.chatSessionPath);
      }
      const active = findActiveSession();
      console.log('active session:', active ? active.sessionId : '(none)', 'hash', active ? active.workspaceHash : '');
      if (active) {
        const events = readSessionEvents(active);
        const withPrompt = events.filter((e) => e.promptText.trim());
        const real = withPrompt.filter((e) => e.tokens && !e.tokens.estimated);
        console.log('events:', events.length, 'withPrompt:', withPrompt.length, 'REAL tokens:', real.length);
        for (const e of real.slice(0, 2).concat(withPrompt.slice(-1))) {
          const t = e.tokens ? \`in=\${e.tokens.inputTokens} out=\${e.tokens.outputTokens} cr=\${e.tokens.copilotCredits ?? '?'} real=\${!e.tokens.estimated}\` : 'no tokens';
          console.log('  turn ' + e.turnIndex + ': "' + e.promptText.slice(0, 45).replace(/\\s+/g, ' ') + '" [' + t + ']');
        }
      }
    `,
    resolveDir: repo,
    loader: 'ts',
  },
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  alias,
  logLevel: 'error',
});

await import(pathToFileURL(out));
