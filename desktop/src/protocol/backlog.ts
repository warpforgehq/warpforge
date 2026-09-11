/** How long finished tasks keep their data, per lifecycle stage (mirrors Rust). */
export interface HistorySettings {
  /** Days before a closed task's conversation is deleted. */
  retentionDays: number;
  /** Days before an ignored diff-less waiting task is settled. 0 = off. */
  settleIgnoredAfterDays: number;
  /** Days before an untouched closed task is deleted outright. 0 = off. */
  deleteClosedAfterDays: number;
}

/** Result of `task.deleteSettled` (mirrors Rust): how the bulk shelf-clear split. */
export interface DeleteSettledResult {
  deleted: number;
  /** Skipped because of unmerged changes, a live run, or a pending permission request. */
  kept: number;
}

export type BacklogStorageMode = "sqlite" | "yaml";

export interface BacklogSettings {
  mode: BacklogStorageMode;
}

export interface BacklogItem {
  id: string;
  number: number;
  project: string;
  title: string;
  body: string;
  status: string;
  priority: string;
  source: "local" | "github" | "linear" | string;
  externalId?: string | null;
  url?: string | null;
  remoteStatus?: string | null;
  assignee?: string | null;
  createdAt: number;
  updatedAt: number;
  taskId?: string | null;
}

export interface BacklogPage {
  items: BacklogItem[];
  page: number;
  pageSize: number;
  total: number;
  hasNextPage: boolean;
}
