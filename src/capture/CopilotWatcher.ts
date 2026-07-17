import * as vscode from 'vscode';
import { join } from 'node:path';
import type { PromptEvent } from '@tokentama/shared-types';
import { getWorkspaceStorageRoot, listCopilotSessions } from './copilotPaths';
import { readSessionEvents } from './copilotReader';

/**
 * Best-effort, read-only live capture of GitHub Copilot Chat. Reads the
 * append-only transcript `.jsonl` files under VS Code's per-workspace storage
 * and emits a PromptEvent for each newly completed user turn.
 *
 * When `onlyHash` is provided (this window's workspace-storage hash), capture is
 * scoped to THIS window's Copilot sessions — so it never picks up chats from
 * other VS Code windows that share the same user-data directory.
 *
 * Watching files outside the workspace can be unreliable, so a lightweight
 * mtime-guarded poll backs up the file-system watcher. Everything degrades
 * gracefully — if nothing is found, the manual command still works.
 */
export class CopilotWatcher implements vscode.Disposable {
  private watcher?: vscode.FileSystemWatcher;
  private readonly seen = new Set<string>();
  private readonly pendingSince = new Map<string, number>();
  /** Last-seen mtime per session, so we only re-read a chat that actually changed. */
  private readonly sessionMtimes = new Map<string, number>();
  private readonly root: string;
  private debounce?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setInterval>;

  constructor(
    private readonly onEvent: (event: PromptEvent, meta?: { preliminary?: boolean }) => void,
    private readonly onlyHash?: string,
    root = getWorkspaceStorageRoot(),
  ) {
    this.root = root;
  }

  isAvailable(): boolean {
    try {
      return listCopilotSessions(this.root, this.onlyHash).length > 0;
    } catch {
      return false;
    }
  }

  start(): void {
    // Mark existing in-scope turns as seen, so only turns that happen AFTER
    // capture starts are emitted (no history replay, no stale first prompt).
    try {
      for (const session of listCopilotSessions(this.root, this.onlyHash)) {
        for (const ev of readSessionEvents(session)) {
          this.seen.add(`${ev.sessionId}:${ev.turnIndex}`);
        }
        this.sessionMtimes.set(session.sessionId, session.modifiedMs);
      }
    } catch {
      /* ignore */
    }

    try {
      const base = this.onlyHash ? join(this.root, this.onlyHash) : this.root;
      const pattern = new vscode.RelativePattern(vscode.Uri.file(base), '**/*.jsonl');
      this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const onChange = (): void => this.scheduleRefresh();
      this.watcher.onDidCreate(onChange);
      this.watcher.onDidChange(onChange);
    } catch {
      /* watcher unavailable — polling still covers us */
    }

    this.poll = setInterval(() => this.refresh(), 1500);
  }

  private scheduleRefresh(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.refresh(), 400);
  }

  private refresh(): void {
    let sessions;
    try {
      sessions = listCopilotSessions(this.root, this.onlyHash);
    } catch {
      return;
    }
    const now = Date.now();
    // Scan EVERY in-scope chat for new turns — not just the newest-mtime one — so
    // we capture the chat the user actually typed in, even if another was touched.
    for (const session of sessions) {
      const prevMtime = this.sessionMtimes.get(session.sessionId) ?? 0;
      const changed = session.modifiedMs > prevMtime;
      const hasPending = [...this.pendingSince.keys()].some((k) =>
        k.startsWith(`${session.sessionId}:`),
      );
      if (!changed && !hasPending) continue;
      this.sessionMtimes.set(session.sessionId, session.modifiedMs);

      let events;
      try {
        events = readSessionEvents(session);
      } catch {
        continue;
      }
      for (const ev of events) {
        if (!ev.promptText.trim()) continue;
        const key = `${ev.sessionId}:${ev.turnIndex}`;
        if (this.seen.has(key)) continue;

        // Wait only for a genuinely in-flight source request. A completed
        // output-only/input-only/unavailable record is final source evidence,
        // not a request that will necessarily gain another meter later.
        if (ev.meteringStatus === 'pending') {
          const since = this.pendingSince.get(key);
          if (since === undefined) {
            // First sight without final tokens: show a preliminary score immediately,
            // then keep waiting for the real metered tokens to finalize it.
            this.pendingSince.set(key, now);
            this.onEvent(ev, { preliminary: true });
            continue;
          }
          if (now - since < 3000) continue;
          // Grace expired — fall through and finalize with estimated tokens.
        }

        this.seen.add(key);
        this.pendingSince.delete(key);
        this.onEvent(ev, { preliminary: false });
      }
    }
  }

  /** Whether a specific turn has already been captured (for the self-test). */
  isSeen(sessionId: string, turnIndex: number): boolean {
    return this.seen.has(`${sessionId}:${turnIndex}`);
  }

  /** Live capture state, for the self-test diagnostics command. */
  diagnostics(): { seen: number; pending: number; trackedSessions: number } {
    return {
      seen: this.seen.size,
      pending: this.pendingSince.size,
      trackedSessions: this.sessionMtimes.size,
    };
  }

  dispose(): void {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.poll) clearInterval(this.poll);
    this.watcher?.dispose();
  }
}
