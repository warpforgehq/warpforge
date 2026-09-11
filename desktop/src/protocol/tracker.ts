// ── Issue trackers (GitHub / Linear) ────────────────────────────────────────

export interface TrackerLinearStatus {
  connected: boolean;
  email?: string | null;
  organization?: string | null;
}

export interface TrackerGithubStatus {
  connected: boolean;
  login?: string | null;
  warning?: string | null;
}

export interface TrackerStatus {
  linear?: TrackerLinearStatus | null;
  github?: TrackerGithubStatus | null;
}

/** A Linear team the connected API key can see. */
export interface LinearTeam {
  id: string;
  key: string;
  name: string;
}

/** Which external-tracker slice a project reads (the Linear team mapping). */
export interface TrackerProjectSettings {
  project: string;
  linearTeamId?: string | null;
  linearTeamName?: string | null;
}

/** Per-project tracker availability — what source filters and pickers key on.
 *  Local is always true; Linear needs a connected key plus a mapped team;
 *  GitHub needs a `gh` session whose repo resolves from the project dir. */
export interface ProjectSources {
  project: string;
  local: boolean;
  linear: boolean;
  github: boolean;
}

/** One persisted backlog-item ↔ external-issue link. */
export interface TrackerLinkInfo {
  itemId: string;
  provider: "github" | "linear";
  externalId: string;
  url: string;
  status: string;
  remoteStatus?: string | null;
  assignee?: string | null;
  lastSyncedAt: number;
  taskId?: string | null;
}

export interface CreateExternalResult {
  itemId: string;
  provider: "github" | "linear";
  externalId: string;
  url: string;
  status: string;
}

export interface SyncedExternalItem {
  id: string;
  url: string;
  status: string;
  remoteStatus?: string | null;
}

/** An issue that existed in a tracker before warpforge knew about it. */
export interface ImportedWorkItem {
  itemId: string;
  number?: number;
  provider: "github" | "linear";
  project: string;
  externalId: string;
  url: string;
  title: string;
  body: string;
  status: string;
  remoteStatus?: string | null;
  /** Remote's last-updated time, unix seconds. */
  updatedAt: number;
}

export interface ExternalWorkItemPage {
  items: ImportedWorkItem[];
  page: number;
  pageSize: number;
  total?: number | null;
  hasNextPage: boolean;
}
