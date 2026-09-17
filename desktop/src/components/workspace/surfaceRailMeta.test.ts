import { describe, expect, it } from "vitest";

import { surfaceSummary } from "./surfaceRailMeta";
import { DEFAULT_SURFACE_TABS } from "./SurfaceTabs";

const tab = (id: string, count?: number) => {
  const found = DEFAULT_SURFACE_TABS.find((candidate) => candidate.id === id)!;
  return { ...found, count };
};

describe("surfaceSummary", () => {
  it("counts in the surface's own noun", () => {
    expect(surfaceSummary(tab("diff", 1))).toBe("1 changed file");
    expect(surfaceSummary(tab("diff", 120))).toBe("120 changed files");
    expect(surfaceSummary(tab("terminal", 2))).toBe("2 sessions");
    expect(surfaceSummary(tab("pipeline", 3))).toBe("3 stages");
  });

  it("keeps the true number where the badge is capped", () => {
    expect(surfaceSummary(tab("diff", 1200))).toBe("1200 changed files");
  });

  it("says what a resting surface is instead of a zero", () => {
    expect(surfaceSummary(tab("diff", 0))).toBe("No changes yet");
    expect(surfaceSummary(tab("runtime"))).toBe("Nothing running");
    expect(surfaceSummary(tab("files"))).toBe("Project tree and editor");
  });
});
