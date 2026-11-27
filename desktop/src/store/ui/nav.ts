import { useSmithsStore } from "@/store/smiths";

import { listViewFor, scopeHolds } from "./panelScope";
import { rememberTaskPlace } from "./projectNav";
import {
  DEFAULT_TASK_SURFACE,
  type DiffView,
  type GlobalView,
  type RepositoryOperation,
  type RightPanel,
  type SidebarMode,
  type TaskOpenNav,
  type TaskSurface,
  type TeamSelection,
  type UiSlice,
  type UiState,
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
  /** Unix seconds the Team view last showed the feed; newer records count as
   *  unread on its nav item. */
  teamSeenAt: number;
  /** The sidebar body's mode. Persisted: the app reopens on the same body. */
  sidebarMode: SidebarMode;
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
   *  composer. A stale id is dropped rather than reopened. Already in Tasks
   *  inside a project or space, it only returns to the list. */
  selectTasksSegment: (validTaskId: string | null) => void;
  /** Open a task; `project` names its project when the snapshot may not list it yet. */
  openTask: (id: string | null, project?: string) => void;
  /** Open a task and immediately surface a specific file/diff in its workspace. */
  openTaskWithNav: (id: string, nav: TaskOpenNav) => void;
  clearOpenTaskNav: () => void;
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

/**
 * Opening a task outside the panel's scope returns the panel to every project,
 * the list switches to the one that shows the task, and the task becomes its
 * project's last place.
 */
function arriveAt(
  s: Pick<UiState, "lastTaskByProject" | "panelScope" | "taskListView" | "view">,
  taskId: string | null,
  project?: string,
): Partial<UiState> {
  if (!taskId) return {};
  const remembered = rememberTaskPlace(s, taskId, project);
  const taskListView = listViewFor(taskId, s.taskListView);
  if (scopeHolds(s.panelScope, taskId)) return { ...remembered, taskListView };
  return {
    ...remembered,
    panelScope: null,
    taskListView,
    view: s.view === "project" ? "start" : s.view,
  };
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
  teamSeenAt: 0,
  sidebarMode: "tasks",
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
    set((s) => {
      if (s.sidebarMode === "tasks" && s.panelScope && !s.settingsOpen) {
        return { panelScope: null, view: s.view === "project" ? "start" : s.view };
      }
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
        taskListView: listViewFor(validTaskId, s.taskListView),
        ...rememberTaskPlace(s, validTaskId),
        lastTaskId: validTaskId,
        openTaskId: validTaskId,
        openTaskNav: null,
        rightPanel: null,
        view,
      };
    }),
  // Contextual task tools must not leak from one task into the next.
  // Project-scoped layout preferences remain persisted.
  // Closing a task keeps `lastTaskId`: that is what the Tasks segment returns to.
  openTask: (openTaskId, project) =>
    set((s) => ({
      ...arriveAt(s, openTaskId, project),
      openTaskId,
      openTaskNav: null,
      rightPanel: null,
      activeSurface: DEFAULT_TASK_SURFACE,
      lastTaskId: openTaskId ?? s.lastTaskId,
      settingsOpen: openTaskId ? false : s.settingsOpen,
    })),
  openTaskWithNav: (openTaskId, openTaskNav) =>
    set((s) => ({
      ...arriveAt(s, openTaskId),
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
      ...arriveAt(s, id),
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
});
