import { describe, expect, it } from "vitest";

import { taskSurfaceTabs, visibleSurface } from "./surfaceTabs";

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
    expect(visibleSurface("diff", true)).toBe("files");
    expect(visibleSurface("terminal", true)).toBe("terminal");
    expect(visibleSurface("diff", false)).toBe("diff");
  });
});
