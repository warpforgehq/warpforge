import { type BacklogParams, DEFAULT_BACKLOG_PARAMS } from "@/components/backlog/types";
import { forgetProject } from "@/lib/sessionStore";
import { browser } from "@/views/task-detail/browser/browserClient";
import { clearBrowserSession } from "@/views/task-detail/browser/browserSession";

import {
  DEFAULT_TASK_SURFACE,
  type DiffView,
  type GlobalView,
  type ProjectSurface,
  type RepositoryOperation,
  type RightPanel,
  type SidebarMode,
  type TaskOpenNav,
  type TaskSurface,
  type TeamSelection,
  type UiSlice,
  type View,
} from "./types";

export interface NavState {
  // Navigation
  view: View;
  openTaskId: string | null; // Transient — not persisted
  /** The task the Tasks segment returns to. Persisted, unlike `openTaskId`:
   *  it is an offer the user takes by picking Tasks, never a task the app
   *  opens on its own. */
  lastTaskId: string | null;
  /** The project subject the app is on. The only current-project truth. */
  selectedProjectId: string | null;
  /** Transient intent to open a task at a specific file/diff. Not persisted. */
  openTaskNav: TaskOpenNav | null;
  // App shell
  attentionTargetId: string | null;
  attentionTargetNonce: number;
  repositoryOperation: RepositoryOperation | null;
  // TaskDetail zones
  showChat: boolean;
  showDiff: boolean;
  diffView: DiffView;
  rightPanel: RightPanel;
  /** Which workspace surface is active in the centre pane. Task-scoped, like `rightPanel`. */
  activeSurface: TaskSurface;
  /**
   * Which surface the project page shows, per project. Persisted like the
   * other project-scoped layout state: reopening a project should land where
   * you left it rather than snapping back to Backlog.
   */
  projectSurfaceByProject: Record<string, ProjectSurface>;
  /**
   * The backlog's filters, sort and search, per project. Persisted because a
   * filter is a stance, not a keystroke: someone who reads their board as
   * "assigned to me" had to say so again on every project switch and every
   * restart. The search term is deliberately dropped on the way to storage —
   * see `partialize` in `store.ts`.
   */
  backlogParamsByProject: Record<string, BacklogParams>;
  /** Unix seconds the Team view last showed the feed; newer records count as
   *  unread on its nav item. */
  teamSeenAt: number;
  /** The sidebar body's mode. Persisted: the app reopens on the same body. */
  sidebarMode: SidebarMode;
  /** The channel, direct thread or Smith the Smiths area shows. Transient. */
  teamSelection: TeamSelection | null;
  /** Unix seconds each teammate's page was last open, by Smith id. */
  teamSmithSeenAt: Record<string, number>;
  /** Unix seconds each channel was last open, by its feed key. */
  teamChannelSeenAt: Record<string, number>;
  /** The project the Smiths sidebar shows; null follows the open project. */
  smithsProject: string | null;

  setView: (v: GlobalView) => void;
  /** Land on the Tasks half of the sidebar: `validTaskId` if the caller found
   *  it still in the daemon snapshot, else the selected project, else Mission
   *  Control. A stale id is dropped rather than reopened. */
  selectTasksSegment: (validTaskId: string | null) => void;
  openTask: (id: string | null) => void;
  /** Open a task and immediately surface a specific file/diff in its workspace. */
  openTaskWithNav: (id: string, nav: TaskOpenNav) => void;
  clearOpenTaskNav: () => void;
  /** Make a project the subject the content column is showing. */
  openProject: (id: string) => void;
  focusAttentionTask: (id: string) => void;
  setRepositoryOperation: (operation: RepositoryOperation | null) => void;
  toggleChat: () => void;
  toggleDiff: () => void;
  setShowChat: (open: boolean) => void;
  setShowDiff: (open: boolean) => void;
  setDiffView: (v: DiffView) => void;
  setRightPanel: (panel: RightPanel) => void;
  setActiveSurface: (surface: TaskSurface) => void;
  setProjectSurface: (project: string, surface: ProjectSurface) => void;
  /** Merge a change into one project's backlog query. */
  patchBacklogParams: (project: string, patch: Partial<BacklogParams>) => void;
  resetBacklogParams: (project: string) => void;
  /** Forget every per-project memory — for a project that was removed. */
  clearProjectState: (project: string) => void;
  markTeamSeen: (at: number) => void;
  setSidebarMode: (mode: SidebarMode) => void;
  /** Show a channel, thread or Smith in the Smiths area, and go there. */
  openTeam: (selection: TeamSelection | null) => void;
  markSmithSeen: (id: string, at: number) => void;
  markChannelSeen: (key: string, at: number) => void;
  setSmithsProject: (project: string | null) => void;
  /** Whether the New smith dialog is open. Transient. */
  newSmithOpen: boolean;
  openNewSmith: () => void;
  closeNewSmith: () => void;
}

export const createNavSlice: UiSlice<NavState> = (set) => ({
  view: "control",
  openTaskId: null,
  lastTaskId: null,
  selectedProjectId: null,
  openTaskNav: null,
  attentionTargetId: null,
  attentionTargetNonce: 0,
  repositoryOperation: null,
  showChat: true,
  showDiff: true,
  diffView: "split",
  rightPanel: null,
  activeSurface: DEFAULT_TASK_SURFACE,
  projectSurfaceByProject: {},
  backlogParamsByProject: {},
  teamSeenAt: 0,
  sidebarMode: "tasks",
  teamSelection: null,
  teamSmithSeenAt: {},
  teamChannelSeenAt: {},
  smithsProject: null,
  newSmithOpen: false,

  setView: (view) => set({ openTaskId: null, openTaskNav: null, view }),
  selectTasksSegment: (validTaskId) =>
    set((s) => {
      const view: View = s.selectedProjectId ? "project" : "control";
      if (!validTaskId) return { lastTaskId: null, openTaskId: null, openTaskNav: null, view };
      return {
        activeSurface: DEFAULT_TASK_SURFACE,
        lastTaskId: validTaskId,
        openTaskId: validTaskId,
        openTaskNav: null,
        rightPanel: null,
        view,
      };
    }),
  openProject: (selectedProjectId) =>
    set({ openTaskId: null, openTaskNav: null, view: "project", selectedProjectId }),
  // Contextual task tools must not leak from one task into the next.
  // Project-scoped layout preferences remain persisted.
  // Closing a task keeps `lastTaskId`: that is what the Tasks segment returns to.
  openTask: (openTaskId) =>
    set((s) => ({
      openTaskId,
      openTaskNav: null,
      rightPanel: null,
      activeSurface: DEFAULT_TASK_SURFACE,
      lastTaskId: openTaskId ?? s.lastTaskId,
    })),
  openTaskWithNav: (openTaskId, openTaskNav) =>
    set({
      openTaskId,
      openTaskNav,
      rightPanel: null,
      activeSurface: openTaskNav.surface,
      lastTaskId: openTaskId,
    }),
  clearOpenTaskNav: () => set({ openTaskNav: null }),
  setSmithsProject: (smithsProject) => set({ smithsProject }),
  openNewSmith: () => set({ newSmithOpen: true }),
  closeNewSmith: () => set({ newSmithOpen: false }),
  markChannelSeen: (key, at) =>
    set((s) => ({ teamChannelSeenAt: { ...s.teamChannelSeenAt, [key]: at } })),
  markSmithSeen: (id, at) => set((s) => ({ teamSmithSeenAt: { ...s.teamSmithSeenAt, [id]: at } })),
  setSidebarMode: (sidebarMode) => set({ sidebarMode }),
  openTeam: (teamSelection) =>
    set({ openTaskId: null, openTaskNav: null, teamSelection, view: "team" }),
  markTeamSeen: (at) => set((s) => (at > s.teamSeenAt ? { teamSeenAt: at } : {})),
  focusAttentionTask: (attentionTargetId) =>
    set((s) => ({
      attentionTargetId,
      attentionTargetNonce: s.attentionTargetNonce + 1,
    })),
  setRepositoryOperation: (repositoryOperation) => set({ repositoryOperation }),
  // Chat + Center are the mutual pair — never let both close. Tree is a
  // Sub-panel of Center, so it toggles freely.
  toggleChat: () => set((s) => (!s.showChat || s.showDiff ? { showChat: !s.showChat } : s)),
  toggleDiff: () => set((s) => (!s.showDiff || s.showChat ? { showDiff: !s.showDiff } : s)),
  setShowChat: (showChat) => set((s) => (!showChat && !s.showDiff ? s : { showChat })),
  setShowDiff: (showDiff) => set((s) => (!showDiff && !s.showChat ? s : { showDiff })),
  setDiffView: (diffView) => set({ diffView }),
  setRightPanel: (rightPanel) => set({ rightPanel }),
  setActiveSurface: (activeSurface) => set({ activeSurface }),
  setProjectSurface: (project, surface) =>
    set((s) => ({
      projectSurfaceByProject: { ...s.projectSurfaceByProject, [project]: surface },
    })),
  patchBacklogParams: (project, patch) =>
    set((s) => ({
      backlogParamsByProject: {
        ...s.backlogParamsByProject,
        [project]: {
          ...(s.backlogParamsByProject[project] ?? DEFAULT_BACKLOG_PARAMS),
          ...patch,
        },
      },
    })),
  resetBacklogParams: (project) =>
    set((s) => ({
      backlogParamsByProject: {
        ...s.backlogParamsByProject,
        [project]: DEFAULT_BACKLOG_PARAMS,
      },
    })),
  clearProjectState: (project) =>
    set((s) => {
      const projectSurfaceByProject = { ...s.projectSurfaceByProject };
      const backlogParamsByProject = { ...s.backlogParamsByProject };
      delete projectSurfaceByProject[project];
      delete backlogParamsByProject[project];
      // The workspace session is a separate cache; forget it alongside the
      // preferences so it cannot outlive the project.
      forgetProject(project);
      // The browser's tabs and its native content views are project-scoped too.
      clearBrowserSession(project);
      void browser.closeProject(project);
      return { backlogParamsByProject, projectSurfaceByProject };
    }),
});
