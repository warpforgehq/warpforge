import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { daemon, type DaemonState } from "@/daemon";
import { EMPTY_SNAPSHOT, type TaskInfo } from "@/protocol";
import { useUi } from "@/store/ui";

function task(id: string, project: string): TaskInfo {
  return {
    agent: "codex",
    blockedReason: null,
    createdAt: 1,
    filesChanged: 0,
    id,
    parentTaskId: null,
    project,
    prompt: id,
    status: "waiting",
    tags: [],
    title: id,
    updatedAt: 1,
  };
}

const initial = useUi.getInitialState();

beforeEach(() => {
  vi.spyOn(daemon, "getState").mockReturnValue({
    snapshot: { ...EMPTY_SNAPSHOT, tasks: [task("a-1", "alpha"), task("b-1", "beta")] },
  } as DaemonState);
});

afterEach(() => {
  vi.restoreAllMocks();
  useUi.setState(initial, true);
});

it("keeps the open task when entering its own project", () => {
  useUi.getState().openTask("a-1");
  useUi.getState().openProject("alpha");

  const ui = useUi.getState();
  expect(ui.panelScope).toEqual({ kind: "project", name: "alpha" });
  expect(ui.openTaskId).toBe("a-1");
  expect(ui.sidebarMode).toBe("tasks");
});

it("shows the remembered section when the open task belongs elsewhere", () => {
  useUi.getState().setProjectSurface("beta", "runtime");
  useUi.getState().openTask("a-1");
  useUi.getState().openProject("beta");

  const ui = useUi.getState();
  expect(ui.openTaskId).toBeNull();
  expect(ui.view).toBe("project");
  expect(ui.projectSurfaceByProject.beta).toBe("runtime");
});

it("remembers a picked section per project", () => {
  useUi.getState().openProject("alpha", "terminal");
  useUi.getState().openProject("beta");
  useUi.getState().openProject("alpha");

  expect(useUi.getState().projectSurfaceByProject).toEqual({ alpha: "terminal" });
});

it("picking a section leaves an open task of the same project", () => {
  useUi.getState().openProject("alpha");
  useUi.getState().openTask("a-1");
  useUi.getState().openProject("alpha", "files");

  expect(useUi.getState().openTaskId).toBeNull();
  expect(useUi.getState().view).toBe("project");
});

it("stays in project mode for its own tasks and leaves it for another project's", () => {
  useUi.getState().openProject("alpha");
  useUi.getState().openTask("a-1");
  expect(useUi.getState().panelScope).toEqual({ kind: "project", name: "alpha" });

  useUi.getState().openTask("b-1");
  expect(useUi.getState().panelScope).toBeNull();
  expect(useUi.getState().view).toBe("start");
});

it("exits to every project's tasks, keeping an open task on screen", () => {
  useUi.getState().openProject("alpha");
  useUi.getState().openTask("a-1");
  useUi.getState().exitPanelScope();

  const ui = useUi.getState();
  expect(ui.panelScope).toBeNull();
  expect(ui.openTaskId).toBe("a-1");
  expect(ui.view).toBe("start");
});

it("forgets the scope of a removed project", () => {
  useUi.getState().openProject("alpha");
  useUi.getState().clearProjectState("alpha");

  expect(useUi.getState().panelScope).toBeNull();
});
