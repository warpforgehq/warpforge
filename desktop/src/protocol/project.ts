/** A git worktree for an isolated task. */
export interface WorktreeInfo {
  taskId: string;
  path: string;
  branch: string;
  baseBranch: string;
}

/** An agent session discovered on disk (claude/codex), resumable via task.resume. */
export interface ExternalSession {
  agent: string;
  sessionId: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

// ── Daemon discovery (~/.warpforge/daemon.json) ─────────────────────────────

export interface DaemonEndpoint {
  pid: number;
  url: string;
  token: string;
  version: string;
  protocolVersion: number;
  owner: "desktop" | "external";
}

export interface DaemonHandshake {
  daemonVersion: string;
  protocolVersion: number;
  owner: "desktop" | "external";
  protocolCompatible: boolean;
  exactVersionMatch: boolean;
}

export interface UpdateHandoff {
  ready: boolean;
  blockers: string[];
}
