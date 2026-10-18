import { describe, expect, it } from "vitest";

import { makeHome, toggleProject } from "./projectSelection";

describe("project selection", () => {
  it("makes the first picked project home and keeps home first", () => {
    let pick = toggleProject({ home: null, projects: [] }, "api");
    pick = toggleProject(pick, "web");
    expect(pick).toStrictEqual({ home: "api", projects: ["api", "web"] });
  });

  it("hands home to the next project when home is unpicked", () => {
    const pick = toggleProject({ home: "api", projects: ["api", "web", "docs"] }, "api");
    expect(pick).toStrictEqual({ home: "web", projects: ["web", "docs"] });
    expect(toggleProject({ home: "api", projects: ["api"] }, "api")).toStrictEqual({
      home: null,
      projects: [],
    });
  });

  it("moves home to another picked project, and ignores an unpicked one", () => {
    const pick = { home: "api", projects: ["api", "web"] };
    expect(makeHome(pick, "web")).toStrictEqual({ home: "web", projects: ["web", "api"] });
    expect(makeHome(pick, "docs")).toBe(pick);
  });
});
