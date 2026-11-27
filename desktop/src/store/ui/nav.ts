import { type BacklogParams, DEFAULT_BACKLOG_PARAMS } from "@/components/backlog/types";
import { forgetProject } from "@/lib/sessionStore";
import { useSmithsStore } from "@/store/smiths";
import { browser } from "@/views/task-detail/browser/browserClient";
import { clearBrowserSession } from "@/views/task-detail/browser/browserSession";

import { type PanelScope, scopeHolds, scopeProjects, taskProject } from "./panelScope";
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
  /** What the Tasks panel is narrowed to; null shows every project. Persisted. */
  panelScope: PanelScope | null;
  /** Return the Tasks panel to every project. */
  exitPanelScope: () => void;
  /**
   * Narrow the Tasks panel to a space's projects. An open task of a member
   * stays on screen; otherwise the main area shows the composer.
   */
  openSpace: (id: string) => void;
  /** Settings fill the main area and the sidebar panel. Transient: any
   *  navigation leaves them. */
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  /** The channel, direct thread or Smith the Smiths area shows. Transient. */
  teamSelection: TeamSelection | null;
  /** The schedule shown in Automations. Transient across app restarts. */
  selectedAutomationId: string | null;
  selectAutomation: (id: string | null) => void;
  /** Unix seconds each teammate's page was last open, by Smith id. */
  teamSmithSeenAt: Record<string, number>;
  /** Unix seconds each channel was last open, by its feed key. */
  teamChannelSeenAt: Record<string, number>;
  /** The project the Smiths sidebar shows; null follows the open project. */
  smithsProject: string | null;

  setView: (v: GlobalView) => void;
  /** Land on the Tasks half of the sidebar: `validTaskId` if the caller found
   *  it still in the daemon snapshot, else the selected project, else the
   *  composer. A stale id is dropped rather than reopened. */
  selectTasksSegment: (validTaskId: string | null) => void;
  openTask: (id: string | null) => void;
  /** Open a task and immediately surface a specific file/diff in its workspace. */
  openTaskWithNav: (id: string, nav: TaskOpenNav) => void;
  clearOpenTaskNav: () => void;
  /**
   * Enter a project's mode. Without `section`, an open task of that project
   * stays on screen; otherwise the project's remembered section shows.
   */
  openProject: (id: string, section?: ProjectSurface) => void;
  /**
   * Open a task from outside the sidebar body (a notification, toast or link) and switch the sidebar to the mode that shows it: a
   * Smith's thread opens that Smith in Smiths mode, any other task opens in
   * Tasks mode, revealed in the tree. Clicks inside the body use `openTask`.
   */
  revealTask: (id: string, nav?: TaskOpenNav) => void;
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

/** Opening a task outside the panel's scope returns the panel to every project. */
function leaveScopeFor(
  s: Pick<NavState, "panelScope" | "view">,
  taskId: string | null,
): Partial<NavState> {
  if (!taskId || scopeHolds(s.panelScope, taskId)) return {};
  return { panelScope: null, view: s.view === "project" ? "start" : s.view };
}

export const createNavSlice: UiSlice<NavState> = (set) => ({
  view: "start",
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
  panelScope: null,
  settingsOpen: false,
  teamSelection: null,
  selectedAutomationId: null,
  teamSmithSeenAt: {},
  teamChannelSeenAt: {},
  smithsProject: null,
  newSmithOpen: false,

  setView: (view) =>
    set((s) => ({
      openTaskId: null,
      openTaskNav: null,
      settingsOpen: false,
      sidebarMode: view === "start" ? "tasks" : view === "automations" ? view : s.sidebarMode,
      view,
    })),
  selectAutomation: (selectedAutomationId) => set({ selectedAutomationId }),
  selectTasksSegment: (validTaskId) =>
    set(() => {
      const view: View = "start";
      if (!validTaskId)
        return {
          lastTaskId: null,
          openTaskId: null,
          openTaskNav: null,
          panelScope: null,
          settingsOpen: false,
          view,
        };
      return {
        activeSurface: DEFAULT_TASK_SURFACE,
        panelScope: null,
        settingsOpen: false,
        lastTaskId: validTaskId,
        openTaskId: validTaskId,
        openTaskNav: null,
        rightPanel: null,
        view,
      };
    }),
  openProject: (selectedProjectId, section) =>
    set((s) => {
      const keepTask =
        !section && s.openTaskId !== null && taskProject(s.openTaskId) === selectedProjectId;
      return {
        ...(keepTask ? {} : { openTaskId: null, openTaskNav: null }),
        ...(section && {
          projectSurfaceByProject: { ...s.projectSurfaceByProject, [selectedProjectId]: section },
        }),
        panelScope: { kind: "project", name: selectedProjectId },
        selectedProjectId,
        settingsOpen: false,
        sidebarMode: "tasks",
        view: "project",
      };
    }),
  openSpace: (id) =>
    set((s) => {
      const scope: PanelScope = { kind: "space", id };
      const keepTask =
        s.openTaskId !== null &&
        (scopeProjects(scope) ?? []).includes(taskProject(s.openTaskId) ?? "");
      return {
        ...(keepTask ? {} : { openTaskId: null, openTaskNav: null }),
        panelScope: scope,
        settingsOpen: false,
        sidebarMode: "tasks",
        view: "start",
      };
    }),
  exitPanelScope: () =>
    set((s) => ({ panelScope: null, view: s.view === "project" ? "start" : s.view })),
  // Contextual task tools must not leak from one task into the next.
  // Project-scoped layout preferences remain persisted.
  // Closing a task keeps `lastTaskId`: that is what the Tasks segment returns to.
  openTask: (openTaskId) =>
    set((s) => ({
      ...leaveScopeFor(s, openTaskId),
      openTaskId,
      openTaskNav: null,
      rightPanel: null,
      activeSurface: DEFAULT_TASK_SURFACE,
      lastTaskId: openTaskId ?? s.lastTaskId,
      settingsOpen: openTaskId ? false : s.settingsOpen,
    })),
  openTaskWithNav: (openTaskId, openTaskNav) =>
    set((s) => ({
      ...leaveScopeFor(s, openTaskId),
      openTaskId,
      openTaskNav,
      rightPanel: null,
      activeSurface: openTaskNav.surface,
      lastTaskId: openTaskId,
      settingsOpen: false,
    })),
  clearOpenTaskNav: () => set({ openTaskNav: null }),
  setSmithsProject: (smithsProject) => set({ smithsProject }),
  openNewSmith: () => set({ newSmithOpen: true }),
  closeNewSmith: () => set({ newSmithOpen: false }),
  markChannelSeen: (key, at) =>
    set((s) => ({ teamChannelSeenAt: { ...s.teamChannelSeenAt, [key]: at } })),
  markSmithSeen: (id, at) => set((s) => ({ teamSmithSeenAt: { ...s.teamSmithSeenAt, [id]: at } })),
  setSidebarMode: (sidebarMode) => set({ sidebarMode }),
  openSettings: () => set({ settingsOpen: true, settingsTarget: null }),
  closeSettings: () => set({ settingsOpen: false }),
  openTeam: (teamSelection) =>
    set({ openTaskId: null, openTaskNav: null, settingsOpen: false, teamSelection, view: "team" }),
  markTeamSeen: (at) => set((s) => (at > s.teamSeenAt ? { teamSeenAt: at } : {})),
  revealTask: (id, nav) => {
    const smith = Object.values(useSmithsStore.getState().smiths).find(
      (candidate) => candidate.threadTaskId === id,
    );
    if (smith) {
      set({
        openTaskId: null,
        openTaskNav: null,
        settingsOpen: false,
        sidebarMode: "team",
        teamSelection: { id: smith.id, kind: "teammate" },
        view: "team",
      });
      return;
    }
    set((s) => ({
      ...leaveScopeFor(s, id),
      activeSurface: nav?.surface ?? DEFAULT_TASK_SURFACE,
      attentionTargetId: id,
      attentionTargetNonce: s.attentionTargetNonce + 1,
      lastTaskId: id,
      openTaskId: id,
      openTaskNav: nav ?? null,
      rightPanel: null,
      settingsOpen: false,
      sidebarMode: "tasks",
    }));
  },
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
      return {
        backlogParamsByProject,
        projectSurfaceByProject,
        selectedProjectId: s.selectedProjectId === project ? null : s.selectedProjectId,
        ...(s.panelScope?.kind === "project" &&
          s.panelScope.name === project && { panelScope: null, view: "start" as const }),
      };
    }),
});
