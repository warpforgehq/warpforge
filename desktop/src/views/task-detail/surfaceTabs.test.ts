import { describe, expect, it } from "vitest";

import { taskSurfaceTabs, visibleSurface } from "./surfaceTabs";

const worktreeTask = { kind: "task" as const, project: "p", tags: [], worktree: "/wt/a" };
const chat = { kind: "chat" as const, project: "", tags: [] };

describe("task surfaces", () => {
  it("gives a chat only its folder and a terminal", () => {
    expect(taskSurfaceTabs({ chat: true, pipelineCount: 2 }).map((tab) => tab.id)).toEqual([
      "files",
      "terminal",
    ]);
    expect(taskSurfaceTabs({ chat: false }).map((tab) => tab.id)).toEqual([
      "files",
      "diff",
      "runtime",
      "terminal",
      "browser",
    ]);
  });

  it("tallies live items on the surface that shows them", () => {
    const tabs = taskSurfaceTabs({
      chat: false,
      live: [
        { kind: "terminal", name: "zsh", scope: "task", state: "running" },
        { kind: "service", name: "web", scope: "project", state: "failed" },
        { kind: "portforward", name: "db", scope: "project", state: "running" },
      ],
    });
    const activity = (id: string) => tabs.find((tab) => tab.id === id)?.activity;
    expect(activity("runtime")).toEqual({ failed: 1, running: 1 });
    expect(activity("terminal")).toEqual({ failed: 0, running: 1 });
    expect(activity("diff")).toBeUndefined();
  });

  it("falls back to the Explorer when a chat cannot show the last surface", () => {
    expect(visibleSurface("diff", chat)).toBe("files");
    expect(visibleSurface("terminal", chat)).toBe("terminal");
    expect(visibleSurface("diff", worktreeTask)).toBe("diff");
  });

  it("offers Keepers on any task outside the Factory", () => {
    const ids = (keepers: boolean) => taskSurfaceTabs({ chat: false, keepers }).map((t) => t.id);
    expect(ids(true)).toEqual(["files", "diff", "runtime", "terminal", "browser", "keepers"]);
    expect(ids(false)).not.toContain("keepers");
    expect(visibleSurface("keepers", worktreeTask)).toBe("keepers");
    expect(visibleSurface("keepers", { ...worktreeTask, tags: ["workflow:fix"] })).toBe("diff");
    expect(visibleSurface("keepers", chat)).toBe("files");
  });

  it("marks the Keepers tab from the task's keeper items", () => {
    const tabs = taskSurfaceTabs({
      chat: false,
      keepers: true,
      live: [{ kind: "keeper", name: "Review", scope: "task", state: "failed" }],
    });
    expect(tabs.find((tab) => tab.id === "keepers")?.activity).toEqual({ failed: 1, running: 0 });
  });
});
