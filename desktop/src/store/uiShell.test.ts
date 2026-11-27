import { beforeEach, describe, expect, it } from "vitest";

import { usePins } from "./pins";
import { useUi } from "./ui";

function persisted(): Record<string, unknown> {
  const stored = JSON.parse(localStorage.getItem("wf-ui") ?? "{}") as {
    state?: Record<string, unknown>;
  };
  return stored.state ?? {};
}

describe("shell state", () => {
  beforeEach(() => {
    localStorage.clear();
    usePins.setState({ pins: [] });
    useUi.setState({ settingsOpen: false, sidebarCollapsed: false, view: "start" });
  });

  it("migrates the retired view and imports legacy task pins exactly once", async () => {
    const project = { kind: "project", id: "warpforge" } as const;
    const task = { kind: "task", id: "t_first" } as const;
    usePins.setState({ pins: [project, task] });
    localStorage.setItem(
      "wf-ui",
      JSON.stringify({
        state: {
          missionControlTab: "pinned",
          pinnedLayout: { t_first: { x: 0, y: 0, w: 2, h: 2 } },
          pinnedTaskIds: [task.id, "t_second", "t_second"],
          sidebarMode: "control",
          view: "control",
        },
        version: 12,
      }),
    );

    await useUi.persist.rehydrate();

    expect(useUi.getState()).toMatchObject({ view: "start", sidebarMode: "tasks" });
    expect(persisted()).not.toHaveProperty("pinnedLayout");
    expect(persisted()).not.toHaveProperty("pinnedTaskIds");
    expect(persisted()).not.toHaveProperty("missionControlTab");
    expect(usePins.getState().pins).toEqual([project, task, { kind: "task", id: "t_second" }]);

    usePins.getState().toggle(task);
    await useUi.persist.rehydrate();
    expect(usePins.getState().pins).toEqual([project, { kind: "task", id: "t_second" }]);
  });

  it("persists the collapsed panel across a reload", async () => {
    useUi.getState().toggleSidebarCollapsed();
    expect(persisted().sidebarCollapsed).toBe(true);

    const stored = localStorage.getItem("wf-ui");
    useUi.setState({ sidebarCollapsed: false });
    if (stored) localStorage.setItem("wf-ui", stored);
    await useUi.persist.rehydrate();

    expect(useUi.getState().sidebarCollapsed).toBe(true);
  });

  it("never reopens on Settings after a reload", () => {
    useUi.getState().openSettings();
    expect(useUi.getState().settingsOpen).toBe(true);
    expect(persisted()).not.toHaveProperty("settingsOpen");
  });

  it("leaves Settings on any navigation", () => {
    const leave: Array<() => void> = [
      () => useUi.getState().setView("inbox"),
      () => useUi.getState().openTask("task-1"),
      () => useUi.getState().openProject("warpforge"),
      () => useUi.getState().selectTasksSegment(null),
      () => useUi.getState().revealTask("task-2"),
    ];
    for (const navigate of leave) {
      useUi.getState().openSettings();
      navigate();
      expect(useUi.getState().settingsOpen).toBe(false);
    }
  });

  it("keeps Settings open when a task is merely closed", () => {
    useUi.getState().openSettings();
    useUi.getState().openTask(null);
    expect(useUi.getState().settingsOpen).toBe(true);
  });
});
