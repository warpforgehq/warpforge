import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { daemon, type DaemonState } from "@/daemon";
import { EMPTY_SNAPSHOT, type TaskInfo } from "@/protocol";
import { useUi } from "@/store/ui";

function task(id: string, project: string, kind?: "chat"): TaskInfo {
  return {
    agent: "codex",
    blockedReason: null,
    createdAt: 1,
    filesChanged: 0,
    id,
    kind,
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
    snapshot: { ...EMPTY_SNAPSHOT, tasks: [task("a-1", "alpha"), task("c-1", "", "chat")] },
  } as DaemonState);
});

afterEach(() => {
  vi.restoreAllMocks();
  useUi.setState(initial, true);
});

it("opening a chat shows Chats and opening a project task shows Tasks", () => {
  useUi.getState().openTask("c-1");
  expect(useUi.getState().taskListView).toBe("chats");

  useUi.getState().openTask("a-1");
  expect(useUi.getState().taskListView).toBe("tasks");
});

it("revealing a chat from outside the tree leaves a project and shows Chats", () => {
  useUi.getState().openProject("alpha");
  useUi.getState().revealTask("c-1");

  const ui = useUi.getState();
  expect(ui.panelScope).toBeNull();
  expect(ui.taskListView).toBe("chats");
});

it("keeps the list for a task the snapshot does not know yet", () => {
  useUi.getState().setTaskListView("chats");
  useUi.getState().openTask("new");
  expect(useUi.getState().taskListView).toBe("chats");
});

it("back from a project returns to the last list", () => {
  useUi.getState().setTaskListView("chats");
  useUi.getState().openProject("alpha");
  useUi.getState().exitPanelScope();

  const ui = useUi.getState();
  expect(ui.panelScope).toBeNull();
  expect(ui.taskListView).toBe("chats");
});

it("picking a list leaves a project scope", () => {
  useUi.getState().openProject("alpha");
  useUi.getState().setTaskListView("chats");

  const ui = useUi.getState();
  expect(ui.panelScope).toBeNull();
  expect(ui.view).toBe("start");
});

it("persists the chosen list", () => {
  useUi.getState().setTaskListView("chats");
  const stored = useUi.persist.getOptions().partialize?.(useUi.getState()) as {
    taskListView?: string;
  };
  expect(stored.taskListView).toBe("chats");
});
