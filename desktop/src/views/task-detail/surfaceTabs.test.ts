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

  it("falls back to the Explorer when a chat cannot show the last surface", () => {
    expect(visibleSurface("diff", true)).toBe("files");
    expect(visibleSurface("terminal", true)).toBe("terminal");
    expect(visibleSurface("diff", false)).toBe("diff");
  });
});
