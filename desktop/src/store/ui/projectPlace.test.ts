import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { daemon, type DaemonState } from "@/daemon";
import { EMPTY_SNAPSHOT, type TaskInfo } from "@/protocol";
import { useUi } from "@/store/ui";

function task(id: string, project: string, status: TaskInfo["status"] = "waiting"): TaskInfo {
  return {
    agent: "codex",
    blockedReason: null,
    createdAt: 1,
    filesChanged: 0,
    id,
    parentTaskId: null,
    project,
    prompt: id,
    status,
    tags: [],
    title: id,
    updatedAt: 1,
  };
}

let tasks: TaskInfo[];
const initial = useUi.getInitialState();

beforeEach(() => {
  tasks = [task("a-1", "alpha"), task("b-1", "beta")];
  vi.spyOn(daemon, "getState").mockImplementation(
    () => ({ snapshot: { ...EMPTY_SNAPSHOT, tasks } }) as DaemonState,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  useUi.setState(initial, true);
});

function talkInAlphaThenVisitBeta() {
  const ui = useUi.getState();
  ui.openProject("alpha", "config");
  ui.openTask("a-1");
  ui.openProject("beta", "backlog");
}

it("returns to the task last opened in a project", () => {
  talkInAlphaThenVisitBeta();
  useUi.getState().openProject("alpha");

  const ui = useUi.getState();
  expect(ui.openTaskId).toBe("a-1");
  expect(ui.panelScope).toEqual({ kind: "project", name: "alpha" });
  expect(ui.view).toBe("project");
});

it("falls back to the section once the task is archived", () => {
  talkInAlphaThenVisitBeta();
  tasks = [task("a-1", "alpha", "done"), task("b-1", "beta")];
  useUi.getState().openProject("alpha");

  expect(useUi.getState().openTaskId).toBeNull();
  expect(useUi.getState().projectSurfaceByProject.alpha).toBe("config");
});

it("falls back to the section once the task is deleted", () => {
  talkInAlphaThenVisitBeta();
  tasks = [task("b-1", "beta")];
  useUi.getState().openProject("alpha");

  expect(useUi.getState().openTaskId).toBeNull();
});

it("a section picked after the task wins", () => {
  const ui = useUi.getState();
  ui.openTask("a-1");
  ui.openProject("alpha", "runtime");
  ui.openProject("beta");
  useUi.getState().openProject("alpha");

  expect(useUi.getState().openTaskId).toBeNull();
  expect(useUi.getState().projectSurfaceByProject.alpha).toBe("runtime");
});

it("a section set from elsewhere wins too", () => {
  useUi.getState().openTask("a-1");
  useUi.getState().setProjectSurface("alpha", "terminal");
  useUi.getState().openProject("beta");
  useUi.getState().openProject("alpha");

  expect(useUi.getState().openTaskId).toBeNull();
});

it("an explicit section always wins over the last task", () => {
  talkInAlphaThenVisitBeta();
  useUi.getState().openProject("alpha", "files");

  expect(useUi.getState().openTaskId).toBeNull();
  expect(useUi.getState().projectSurfaceByProject.alpha).toBe("files");
});

it("remembers a new task the snapshot does not list yet", () => {
  useUi.getState().openTask("fresh", "alpha");
  useUi.getState().openProject("beta");
  tasks = [...tasks, task("fresh", "alpha")];
  useUi.getState().openProject("alpha");

  expect(useUi.getState().openTaskId).toBe("fresh");
});

it("persists the last place and forgets it with the project", () => {
  useUi.getState().openTask("a-1");
  const stored = useUi.persist.getOptions().partialize?.(useUi.getState()) as {
    lastTaskByProject?: Record<string, string>;
  };
  expect(stored.lastTaskByProject).toEqual({ alpha: "a-1" });

  useUi.getState().clearProjectState("alpha");
  expect(useUi.getState().lastTaskByProject).toEqual({});
});
