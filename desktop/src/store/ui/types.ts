import type { StateCreator } from "zustand";

import type { EditHunk } from "../../protocol";
import type { LayoutState } from "./layout";
import type { NavState } from "./nav";
import type { PinnedState } from "./pinned";
import type { SettingsState } from "./settings";

/**
 * Client-side UI state (view, panel toggles, prefs) — persisted to localStorage.
 * The server-data store is `daemon/` (useSyncExternalStore); this owns UI only.
 */

/** A destination the nav can address. */
export type GlobalView = "control" | "inbox" | "automations";
/** "project" is a subject, not a nav destination: it is reached by selecting a
 *  project in the sidebar tree, never from NAV. */
export type View = GlobalView | "project";
/** Page shown in the Settings overlay's left rail. */
export type SettingsPage =
  | "appearance"
  | "agents"
  | "integrations"
  | "tasks"
  | "memory"
  | "advanced";
export type DiffView = "unified" | "split";
export type RightPanel = "changes" | "files" | "subtasks" | null;
export type RepositoryOperation = { taskId: string; kind: "pull" | "push" };

/** Center-pane workspace surface. Exactly one is active per task at a time. */
export type TaskSurface = "files" | "diff" | "runtime" | "terminal" | "browser" | "pipeline";
export const DEFAULT_TASK_SURFACE: TaskSurface = "diff";

/** Project-page surface. */
export type ProjectSurface = "backlog" | "pulls" | "files" | "runtime" | "terminal";
export const DEFAULT_PROJECT_SURFACE: ProjectSurface = "backlog";

/** Transient intent to open a task already showing a specific file/diff. */
export type TaskOpenNav =
  | { surface: "files"; path: string; line?: number; column?: number }
  | { surface: "diff"; path: string; hunks?: EditHunk[] };

export interface PinnedTileLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Glass tint of the chrome surfaces — 1 is opaque, below this the app is unreadable. */
export const SIDEBAR_OPACITY_MIN = 0.6;
export const SIDEBAR_OPACITY_MAX = 1;
export const SIDEBAR_OPACITY_DEFAULT = 0.85;

/** Native background blur radius. Higher costs more to composite. */
export const BLUR_RADIUS_MIN = 1;
export const BLUR_RADIUS_MAX = 64;
export const BLUR_RADIUS_DEFAULT = 24;

export const SIDEBAR_WIDTH_DEFAULT = 340;
export const SIDEBAR_WIDTH_MIN = 260;
export const SIDEBAR_WIDTH_MAX = 480;

export function clampSidebarWidth(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(v)));
}

export interface UiState extends NavState, LayoutState, SettingsState, PinnedState {}

export type UiSlice<T> = StateCreator<UiState, [["zustand/persist", unknown]], [], T>;
