import { type BacklogParams, DEFAULT_BACKLOG_PARAMS } from "@/components/backlog/types";
import { daemon } from "@/daemon";
import { forgetProject } from "@/lib/sessionStore";
import { browser } from "@/views/task-detail/browser/browserClient";
import { clearBrowserSession } from "@/views/task-detail/browser/browserSession";

import { type PanelScope, scopeProjects, type TaskListView, taskProject } from "./panelScope";
import { DEFAULT_TASK_SURFACE, type ProjectSurface, type UiSlice } from "./types";

export interface ProjectNavState {
  /**
   * Which surface the project page shows, per project. Persisted like the
   * other project-scoped layout state: reopening a project should land where
   * you left it rather than snapping back to Backlog.
   */
  projectSurfaceByProject: Record<string, ProjectSurface>;
  /**
   * The task opened last in each project, when that is more recent than a
   * section pick. Opening the project returns to it. Persisted.
   */
  lastTaskByProject: Record<string, string>;
  /**
   * The backlog's filters, sort and search, per project. Persisted because a
   * filter is a stance, not a keystroke: someone who reads their board as
   * "assigned to me" had to say so again on every project switch and every
   * restart. The search term is deliberately dropped on the way to storage —
   * see `partialize` in `store.ts`.
   */
  backlogParamsByProject: Record<string, BacklogParams>;
  /** What the Tasks panel is narrowed to; null shows every project. Persisted. */
  panelScope: PanelScope | null;
  /** The unscoped panel's list; back from a project or space returns to it. Persisted. */
  taskListView: TaskListView;
  /** Show project tasks or chats, leaving any project or space scope. */
  setTaskListView: (view: TaskListView) => void;
  /**
   * Narrow the Tasks panel to a space's projects. An open task of a member
   * stays on screen; otherwise the main area shows the composer.
   */
  openSpace: (id: string) => void;
  /**
   * Enter a project's mode. Without `section`, an open task of that project
   * stays on screen, else the project's last task if it is still live, else
   * its remembered section. With `section`, that section shows.
   */
  openProject: (id: string, section?: ProjectSurface) => void;
  setProjectSurface: (project: string, surface: ProjectSurface) => void;
  /** Merge a change into one project's backlog query. */
  patchBacklogParams: (project: string, patch: Partial<BacklogParams>) => void;
  resetBacklogParams: (project: string) => void;
  /** Forget every per-project memory — for a project that was removed. */
  clearProjectState: (project: string) => void;
}

/** The remembered task, if it is still on the board and not archived. */
function liveTask(project: string, taskId: string | undefined): string | null {
  if (!taskId) return null;
  const task = daemon.getState?.().snapshot?.tasks.find((candidate) => candidate.id === taskId);
  return task && task.project === project && task.status !== "done" ? task.id : null;
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

/**
 * Records a task as its project's last place.
 * @param s the current per-project task memory
 * @param taskId the task being opened
 * @param project its project when the snapshot may not list it yet
 * @returns the state patch, empty for chats and unknown tasks
 */
export function rememberTaskPlace(
  s: Pick<ProjectNavState, "lastTaskByProject">,
  taskId: string | null,
  project?: string,
): Partial<ProjectNavState> {
  if (!taskId) return {};
  const owner = taskProject(taskId) ?? project;
  if (!owner || s.lastTaskByProject[owner] === taskId) return {};
  return { lastTaskByProject: { ...s.lastTaskByProject, [owner]: taskId } };
}

export const createProjectNavSlice: UiSlice<ProjectNavState> = (set) => ({
  projectSurfaceByProject: {},
  lastTaskByProject: {},
  backlogParamsByProject: {},
  panelScope: null,
  taskListView: "tasks",

  openProject: (selectedProjectId, section) =>
    set((s) => {
      const keepTask =
        !section && s.openTaskId !== null && taskProject(s.openTaskId) === selectedProjectId;
      const resume =
        section || keepTask
          ? null
          : liveTask(selectedProjectId, s.lastTaskByProject[selectedProjectId]);
      return {
        ...(keepTask ? {} : { openTaskId: null, openTaskNav: null }),
        ...(resume && {
          activeSurface: DEFAULT_TASK_SURFACE,
          lastTaskId: resume,
          openTaskId: resume,
          rightPanel: null,
        }),
        ...(section && {
          lastTaskByProject: withoutKey(s.lastTaskByProject, selectedProjectId),
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
      const members = scopeProjects(scope) ?? [];
      const keepTask = s.openTaskId !== null && members.includes(taskProject(s.openTaskId) ?? "");
      const selectedProjectId =
        s.selectedProjectId && members.includes(s.selectedProjectId)
          ? s.selectedProjectId
          : (members[0] ?? s.selectedProjectId);
      return {
        ...(keepTask ? {} : { openTaskId: null, openTaskNav: null }),
        panelScope: scope,
        selectedProjectId,
        settingsOpen: false,
        sidebarMode: "tasks",
        view: "start",
      };
    }),
  setTaskListView: (taskListView) =>
    set((s) => ({
      panelScope: null,
      settingsOpen: false,
      sidebarMode: "tasks",
      taskListView,
      view: s.view === "project" ? "start" : s.view,
    })),
  setProjectSurface: (project, surface) =>
    set((s) => ({
      lastTaskByProject: withoutKey(s.lastTaskByProject, project),
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
        lastTaskByProject: withoutKey(s.lastTaskByProject, project),
        projectSurfaceByProject,
        selectedProjectId: s.selectedProjectId === project ? null : s.selectedProjectId,
        ...(s.panelScope?.kind === "project" &&
          s.panelScope.name === project && { panelScope: null, view: "start" as const }),
      };
    }),
});
