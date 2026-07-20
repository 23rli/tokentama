import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';

export interface CopilotSessionPaths {
  sessionId: string;
  workspaceHash: string;
  /** Copilot can create `chatSessions` before (or without) a transcript. */
  transcriptPath?: string;
  chatSessionPath?: string;
  modelsJsonPath?: string;
  modifiedMs: number;
}

/** Root of VS Code per-workspace storage (stable build). Override via env or arg. */
export function getWorkspaceStorageRoot(override?: string): string {
  if (override) return override;
  const configuredRoot =
    process.env.TOKENLENS_COPILOT_WORKSPACE_STORAGE ??
    process.env.ECO_COPILOT_WORKSPACE_STORAGE;
  if (configuredRoot) {
    return configuredRoot;
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage');
  }
  if (process.platform !== 'win32') {
    const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
    return join(configHome, 'Code', 'User', 'workspaceStorage');
  }
  const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
  return join(appData, 'Code', 'User', 'workspaceStorage');
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function safeMtime(p: string): number {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function findModelsJson(root: string, hash: string, sessionId: string): string | undefined {
  const p = join(root, hash, 'GitHub.copilot-chat', 'debug-logs', sessionId, 'models.json');
  return existsSync(p) ? p : undefined;
}

/** Enumerate all Copilot chat sessions on disk, newest source file first. */
export function listCopilotSessions(
  root = getWorkspaceStorageRoot(),
  onlyHash?: string,
): CopilotSessionPaths[] {
  const sessions: CopilotSessionPaths[] = [];
  if (!existsSync(root)) return sessions;

  for (const hash of safeReaddir(root)) {
    if (onlyHash && hash !== onlyHash) continue;
    const transcriptsDir = join(root, hash, 'GitHub.copilot-chat', 'transcripts');
    const chatSessionsDir = join(root, hash, 'chatSessions');
    const files = new Set([
      ...safeReaddir(transcriptsDir),
      ...safeReaddir(chatSessionsDir),
    ]);

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const sessionId = file.replace(/\.jsonl$/, '');
      const transcriptPath = join(transcriptsDir, file);
      const chatSessionPath = join(chatSessionsDir, file);
      const hasTranscript = existsSync(transcriptPath);
      const hasChatSession = existsSync(chatSessionPath);
      if (!hasTranscript && !hasChatSession) continue;
      const modelsJsonPath = findModelsJson(root, hash, sessionId);
      sessions.push({
        sessionId,
        workspaceHash: hash,
        transcriptPath: hasTranscript ? transcriptPath : undefined,
        chatSessionPath: hasChatSession ? chatSessionPath : undefined,
        modelsJsonPath,
        modifiedMs: Math.max(
          hasTranscript ? safeMtime(transcriptPath) : 0,
          hasChatSession ? safeMtime(chatSessionPath) : 0,
          modelsJsonPath ? safeMtime(modelsJsonPath) : 0,
        ),
      });
    }
  }
  return sessions.sort((a, b) => b.modifiedMs - a.modifiedMs);
}

/** The most recently active Copilot chat session, if any. */
export function findActiveSession(
  root = getWorkspaceStorageRoot(),
  onlyHash?: string,
): CopilotSessionPaths | undefined {
  return listCopilotSessions(root, onlyHash)[0];
}
