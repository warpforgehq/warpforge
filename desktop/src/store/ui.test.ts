import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_BACKLOG_PARAMS } from "@/components/backlog/types";
import { DEFAULT_INBOX_FILTERS } from "@/lib/inboxFilters";

import {
  clampSidebarWidth,
  DEFAULT_TASK_SURFACE,
  SIDEBAR_OPACITY_MIN,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  useUi,
} from "./ui";

describe("task-detail UI state", () => {
  beforeEach(() => {
    localStorage.clear();
    useUi.setState({
      openTaskId: null,
      projectSurfaceByProject: { warpforge: "runtime" },
      repositoryOperation: null,
      rightPanel: "changes",
      showChat: true,
      showDiff: true,
    });
  });

  it("resets contextual tools without disturbing project-scoped layout", () => {
    useUi.getState().openTask("next-task");

    expect(useUi.getState().openTaskId).toBe("next-task");
    expect(useUi.getState().rightPanel).toBeNull();
    expect(useUi.getState().projectSurfaceByProject).toEqual({ warpforge: "runtime" });
    expect(useUi.getState().showChat).toBe(true);
    expect(useUi.getState().showDiff).toBe(true);
  });

  it("tracks and persists the project page surface per project", async () => {
    useUi.setState({ projectSurfaceByProject: {} });
    useUi.getState().setProjectSurface("alpha", "runtime");
    useUi.getState().setProjectSurface("beta", "backlog");

    expect(useUi.getState().projectSurfaceByProject).toEqual({
      alpha: "runtime",
      beta: "backlog",
    });

    const persistedValue = localStorage.getItem("wf-ui");
    useUi.setState({ projectSurfaceByProject: {} });
    if (persistedValue) localStorage.setItem("wf-ui", persistedValue);
    await useUi.persist.rehydrate();
    expect(useUi.getState().projectSurfaceByProject).toEqual({
      alpha: "runtime",
      beta: "backlog",
    });

    useUi.getState().clearProjectState("alpha");
    expect(useUi.getState().projectSurfaceByProject).toEqual({ beta: "backlog" });
  });

  it("remembers a project's backlog filters, but not its search term", async () => {
    useUi.setState({ backlogParamsByProject: {} });
    useUi.getState().patchBacklogParams("alpha", { assignee: "lapa2112" });
    useUi.getState().patchBacklogParams("alpha", { search: "chart", sortBy: "priority" });

    expect(useUi.getState().backlogParamsByProject.alpha).toMatchObject({
      assignee: "lapa2112",
      search: "chart",
      sortBy: "priority",
    });

    const persistedValue = localStorage.getItem("wf-ui");
    useUi.setState({ backlogParamsByProject: {} });
    if (persistedValue) localStorage.setItem("wf-ui", persistedValue);
    await useUi.persist.rehydrate();

    // The stance survives; the lookup does not — a term typed days ago would
    // reopen the board narrowed for no visible reason.
    expect(useUi.getState().backlogParamsByProject.alpha).toMatchObject({
      assignee: "lapa2112",
      sortBy: "priority",
      search: "",
    });

    useUi.getState().resetBacklogParams("alpha");
    expect(useUi.getState().backlogParamsByProject.alpha).toEqual(DEFAULT_BACKLOG_PARAMS);

    useUi.getState().clearProjectState("alpha");
    expect(useUi.getState().backlogParamsByProject.alpha).toBeUndefined();
  });

  it("tracks transient repository activity for the task footer", () => {
    useUi.getState().setRepositoryOperation({ kind: "pull", taskId: "task-1" });

    expect(useUi.getState().repositoryOperation).toEqual({ kind: "pull", taskId: "task-1" });

    useUi.getState().setRepositoryOperation(null);
    expect(useUi.getState().repositoryOperation).toBeNull();
  });
});

describe("the task the Tasks segment returns to", () => {
  beforeEach(() => {
    localStorage.clear();
    useUi.setState({
      lastTaskId: null,
      openTaskId: null,
      selectedProjectId: null,
      view: "control",
    });
  });

  it("remembers the task that was opened, and keeps it after it is closed", () => {
    useUi.getState().openTask("task-1");
    expect(useUi.getState().lastTaskId).toBe("task-1");

    useUi.getState().openTask(null);
    expect(useUi.getState().openTaskId).toBeNull();
    expect(useUi.getState().lastTaskId).toBe("task-1");
  });

  it("remembers a task opened straight onto a file", () => {
    useUi.getState().openTaskWithNav("task-2", { path: "src/app.rs", surface: "files" });

    expect(useUi.getState().lastTaskId).toBe("task-2");
  });

  it("reopens the last task and leaves the inbox behind", () => {
    useUi.setState({ lastTaskId: "task-1", selectedProjectId: "warpforge", view: "inbox" });

    useUi.getState().selectTasksSegment("task-1");

    expect(useUi.getState().openTaskId).toBe("task-1");
    // The view moves off the inbox too, so closing the task lands on the tasks
    // side rather than bouncing back to the review queue.
    expect(useUi.getState().view).toBe("project");
    expect(useUi.getState().activeSurface).toBe(DEFAULT_TASK_SURFACE);
  });

  it("falls back to the selected project, then to Mission Control", () => {
    useUi.setState({ lastTaskId: null, selectedProjectId: "warpforge", view: "inbox" });
    useUi.getState().selectTasksSegment(null);
    expect(useUi.getState().view).toBe("project");
    expect(useUi.getState().openTaskId).toBeNull();

    useUi.setState({ selectedProjectId: null, view: "inbox" });
    useUi.getState().selectTasksSegment(null);
    expect(useUi.getState().view).toBe("control");
  });

  it("drops a remembered task the caller could not find instead of reopening it", () => {
    useUi.setState({ lastTaskId: "deleted-while-away", view: "inbox" });

    // The host validates against the daemon snapshot and passes null when the
    // task is gone.
    useUi.getState().selectTasksSegment(null);

    expect(useUi.getState().lastTaskId).toBeNull();
    expect(useUi.getState().openTaskId).toBeNull();
  });

  it("persists the remembered task, but never the open one", async () => {
    useUi.getState().openTask("task-1");

    const stored = localStorage.getItem("wf-ui");
    const persisted = JSON.parse(stored ?? "{}") as {
      state?: { lastTaskId?: unknown; openTaskId?: unknown };
    };
    expect(persisted.state?.lastTaskId).toBe("task-1");
    expect(persisted.state?.openTaskId).toBeUndefined();

    // A reload offers the task; it must not force it open.
    useUi.setState({ lastTaskId: null, openTaskId: null });
    if (stored) localStorage.setItem("wf-ui", stored);
    await useUi.persist.rehydrate();

    expect(useUi.getState().lastTaskId).toBe("task-1");
    expect(useUi.getState().openTaskId).toBeNull();
  });

  it("starts version 5 installs with no remembered task", async () => {
    localStorage.setItem(
      "wf-ui",
      JSON.stringify({ state: { lastTaskId: "ancient", view: "control" }, version: 5 }),
    );

    await useUi.persist.rehydrate();

    expect(useUi.getState().lastTaskId).toBeNull();
    expect(useUi.getState().view).toBe("control");
  });
});

describe("sidebar width state", () => {
  beforeEach(() => {
    localStorage.clear();
    useUi.setState({
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    });
  });

  it("uses a conservative default width", () => {
    expect(useUi.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT);
  });

  it("clamps sidebar width to min/max", () => {
    useUi.getState().setSidebarWidth(100);
    expect(useUi.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_MIN);

    useUi.getState().setSidebarWidth(999);
    expect(useUi.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_MAX);

    useUi.getState().setSidebarWidth(350);
    expect(useUi.getState().sidebarWidth).toBe(350);
  });

  it("handles malformed width values", () => {
    useUi.getState().setSidebarWidth(NaN);
    expect(useUi.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT);

    useUi.getState().setSidebarWidth(Infinity);
    expect(useUi.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT);
  });

  it("clampSidebarWidth handles non-number inputs", () => {
    expect(clampSidebarWidth(undefined)).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(clampSidebarWidth("300")).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(clampSidebarWidth(null)).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(clampSidebarWidth(300)).toBe(300);
  });

  it("rehydrates persisted sidebar width", async () => {
    useUi.getState().setSidebarWidth(400);

    const stored = localStorage.getItem("wf-ui");
    useUi.setState({ sidebarWidth: SIDEBAR_WIDTH_DEFAULT });
    if (stored) localStorage.setItem("wf-ui", stored);
    await useUi.persist.rehydrate();

    expect(useUi.getState().sidebarWidth).toBe(400);
  });
});

describe("task workspace surface state", () => {
  beforeEach(() => {
    localStorage.clear();
    useUi.setState({
      activeSurface: DEFAULT_TASK_SURFACE,
      openTaskId: null,
      showChat: true,
      showDiff: true,
    });
  });

  it("defaults to a single split state with Diff active", () => {
    expect(useUi.getState().showChat).toBe(true);
    expect(useUi.getState().showDiff).toBe(true);
    expect(useUi.getState().activeSurface).toBe("diff");
  });

  it("focuses conversation and restores split view", () => {
    useUi.getState().setShowDiff(false);
    expect(useUi.getState().showChat).toBe(true);
    expect(useUi.getState().showDiff).toBe(false);

    useUi.getState().setShowDiff(true);
    expect(useUi.getState().showChat).toBe(true);
    expect(useUi.getState().showDiff).toBe(true);
  });

  it("focuses the surface pane and restores split view", () => {
    useUi.getState().toggleChat();
    expect(useUi.getState().showChat).toBe(false);
    expect(useUi.getState().showDiff).toBe(true);

    useUi.getState().toggleChat();
    expect(useUi.getState().showChat).toBe(true);
    expect(useUi.getState().showDiff).toBe(true);
  });

  it("switches the active surface to exactly one value at a time", () => {
    useUi.getState().setActiveSurface("files");
    expect(useUi.getState().activeSurface).toBe("files");

    useUi.getState().setActiveSurface("runtime");
    expect(useUi.getState().activeSurface).toBe("runtime");

    useUi.getState().setActiveSurface("pipeline");
    expect(useUi.getState().activeSurface).toBe("pipeline");
  });

  it("clears task-specific surface selection when opening a new task", () => {
    useUi.getState().setActiveSurface("files");

    useUi.getState().openTask("next-task");

    expect(useUi.getState().openTaskId).toBe("next-task");
    expect(useUi.getState().activeSurface).toBe(DEFAULT_TASK_SURFACE);
  });

  it("does not persist activeSurface across reload", () => {
    useUi.getState().setActiveSurface("pipeline");

    const persistedValue = localStorage.getItem("wf-ui");
    const persisted = JSON.parse(persistedValue ?? "{}") as {
      state?: { activeSurface?: unknown };
    };
    expect(persisted.state?.activeSurface).toBeUndefined();
  });

  it("migrates old persisted wf-ui state without an activeSurface key without throwing", async () => {
    const legacyState = {
      diffView: "split",
      rightPanel: null,
      runtimeOpenByProject: {},
      showChat: true,
      showDiff: true,
    };
    localStorage.setItem("wf-ui", JSON.stringify({ state: legacyState, version: 2 }));

    await expect(useUi.persist.rehydrate()).resolves.not.toThrow();

    // No stored value for the new key — falls back to a valid, defined surface.
    expect(["files", "diff", "runtime", "terminal", "pipeline"]).toContain(
      useUi.getState().activeSurface,
    );
  });

  it("moves a persisted view off the removed Board screen", async () => {
    // `view` is persisted and the Board view is gone, so without this
    // migration a session that ended there rehydrates a `view` no branch
    // renders.
    localStorage.setItem("wf-ui", JSON.stringify({ state: { view: "board" }, version: 2 }));

    await useUi.persist.rehydrate();

    expect(useUi.getState().view).toBe("control");
  });

  it("leaves a persisted view alone when it is still reachable", async () => {
    localStorage.setItem("wf-ui", JSON.stringify({ state: { view: "inbox" }, version: 2 }));

    await useUi.persist.rehydrate();

    expect(useUi.getState().view).toBe("inbox");
  });

  it("turns the removed Projects route into the project subject it was showing", async () => {
    localStorage.setItem(
      "wf-ui",
      JSON.stringify({ state: { selectedProjectId: "warpforge", view: "projects" }, version: 4 }),
    );

    await useUi.persist.rehydrate();

    expect(useUi.getState().view).toBe("project");
    expect(useUi.getState().selectedProjectId).toBe("warpforge");
  });

  it("lands on Mission Control when the removed Projects route had no selection", async () => {
    // With no nav item left to re-enter, `view: "project"` with a null
    // selection would show whichever project happens to be first.
    localStorage.setItem(
      "wf-ui",
      JSON.stringify({ state: { selectedProjectId: null, view: "projects" }, version: 4 }),
    );

    await useUi.persist.rehydrate();

    expect(useUi.getState().view).toBe("control");
  });

  it("migrates version 3 glass settings onto the new defaults", async () => {
    localStorage.setItem(
      "wf-ui",
      JSON.stringify({
        state: {
          bodyGlass: true,
          pullFilesPanelCollapsed: true,
          sidebarOpacity: 0.3,
        },
        version: 3,
      }),
    );

    await useUi.persist.rehydrate();

    expect(useUi.getState().bodyGlass).toBe(false);
    expect(useUi.getState().sidebarOpacity).toBe(SIDEBAR_OPACITY_MIN);
  });

  it("leaves a persisted sidebarOpacity alone once it already clears the new floor", async () => {
    localStorage.setItem("wf-ui", JSON.stringify({ state: { sidebarOpacity: 0.75 }, version: 3 }));

    await useUi.persist.rehydrate();

    expect(useUi.getState().sidebarOpacity).toBe(0.75);
  });
});

describe("rail layout defaults", () => {
  // Runs before anything in this file touches the flag: the point is the value
  // the store is created with, which used to be a one-time window-width read.
  it("opens the changed-files rail instead of guessing from the window width", () => {
    expect(useUi.getState().pullFilesPanelCollapsed).toBe(false);
  });

  it("does not persist pullFilesPanelCollapsed across reload", () => {
    localStorage.clear();
    useUi.setState({ pullFilesPanelCollapsed: true });

    const persisted = JSON.parse(localStorage.getItem("wf-ui") ?? "{}") as {
      state?: { pullFilesPanelCollapsed?: unknown };
    };

    // Re-derived from the room the rail actually has, so a stored value would
    // only fight the measurement.
    expect(persisted.state?.pullFilesPanelCollapsed).toBeUndefined();
  });
});

describe("inbox selection and filters", () => {
  beforeEach(() => {
    localStorage.clear();
    useUi.setState({ inboxFilters: DEFAULT_INBOX_FILTERS, inboxSelectedKey: null });
  });

  it("holds the reviewed pull request outside the components that show it", () => {
    useUi.getState().setInboxSelectedKey("owner/repo#482");
    expect(useUi.getState().inboxSelectedKey).toBe("owner/repo#482");
  });

  it("does not persist the selected pull request across reload", () => {
    useUi.getState().setInboxSelectedKey("owner/repo#482");

    const persisted = JSON.parse(localStorage.getItem("wf-ui") ?? "{}") as {
      state?: { inboxSelectedKey?: unknown };
    };
    expect(persisted.state?.inboxSelectedKey).toBeUndefined();
  });

  it("remembers the inbox filters, but not the search term", async () => {
    useUi.getState().setInboxFilters({ assignedToMe: true, search: "races", state: "all" });

    const stored = localStorage.getItem("wf-ui");
    useUi.setState({ inboxFilters: DEFAULT_INBOX_FILTERS });
    if (stored) localStorage.setItem("wf-ui", stored);
    await useUi.persist.rehydrate();

    expect(useUi.getState().inboxFilters).toEqual({
      assignedToMe: true,
      search: "",
      state: "all",
    });
  });
});
