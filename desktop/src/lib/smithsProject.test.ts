import { describe, expect, it } from "vitest";

import { resolveSmithsProject } from "./smithsProject";

describe("resolveSmithsProject", () => {
  const projects = ["warpforge", "api"];

  it("prefers the project picked in the Smiths sidebar", () => {
    expect(resolveSmithsProject("api", projects, "warpforge")).toBe("api");
  });

  it("follows the project open in Tasks until one is picked", () => {
    expect(resolveSmithsProject(null, projects, "api")).toBe("api");
  });

  it("falls back when the remembered project is gone", () => {
    expect(resolveSmithsProject("removed", projects, null)).toBe("warpforge");
    expect(resolveSmithsProject(null, [], null)).toBeNull();
  });
});
