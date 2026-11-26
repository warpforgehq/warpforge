import { beforeEach, describe, expect, it } from "vitest";

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
    useUi.setState({ settingsOpen: false, sidebarCollapsed: false, view: "control" });
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
