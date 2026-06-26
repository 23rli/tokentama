import * as vscode from 'vscode';
import { join } from 'node:path';
import type { PromptEvent } from '@tokentama/shared-types';
import { findActiveSession, getWorkspaceStorageRoot, listCopilotSessions } from './copilotPaths';
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
  private readonly root = getWorkspaceStorageRoot();
  private debounce?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setInterval>;
  private lastMtime = 0;

  constructor(
    private readonly onEvent: (event: PromptEvent) => void,
    private readonly onlyHash?: string,
  ) {}

  isAvailable(): boolean {
    try {
      return listCopilotSessions(this.root, this.onlyHash).length > 0;
    } catch {
      return false;
    }
  }

  start(): void {
    // Mark existing in-scope turns as seen, so only turns that happen AFTER
    // capture starts are emitted (no history replay).
    try {
      for (const session of listCopilotSessions(this.root, this.onlyHash)) {
        for (const ev of readSessionEvents(session)) {
          this.seen.add(`${ev.sessionId}:${ev.turnIndex}`);
        }
        this.lastMtime = Math.max(this.lastMtime, session.modifiedMs);
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
    let active;
    try {
      active = findActiveSession(this.root, this.onlyHash);
    } catch {
      return;
    }
    if (!active) return;
    // Process when the session changed OR while we're still waiting on a turn's
    // real tokens (so the grace-period fallback below can fire even if idle).
    const changed = active.modifiedMs > this.lastMtime;
    if (!changed && this.pendingSince.size === 0) return;
    if (changed) this.lastMtime = active.modifiedMs;

    const now = Date.now();
    for (const ev of readSessionEvents(active)) {
      if (!ev.promptText.trim()) continue;
      const key = `${ev.sessionId}:${ev.turnIndex}`;
      if (this.seen.has(key)) continue;

      // Prefer REAL metered tokens, but don't wait forever — emit with estimates
      // after a short grace so the prompt always appears promptly.
      const hasRealTokens = !(ev.tokens && ev.tokens.estimated);
      if (!hasRealTokens) {
        const since = this.pendingSince.get(key) ?? now;
        this.pendingSince.set(key, since);
        if (now - since < 3000) continue;
      }

      this.seen.add(key);
      this.pendingSince.delete(key);
      this.onEvent(ev);
    }
  }

  dispose(): void {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.poll) clearInterval(this.poll);
    this.watcher?.dispose();
  }
}
