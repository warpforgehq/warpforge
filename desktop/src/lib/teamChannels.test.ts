import { describe, expect, it } from "vitest";

import { projectChannels } from "./teamChannels";

describe("projectChannels", () => {
  it("is #general alone until the daemon names others", () => {
    expect(projectChannels("demo")).toStrictEqual([
      { id: "general", key: "demo::team", name: "general", project: "demo" },
    ]);
  });

  it("keeps #general first and sorts the named ones", () => {
    const channels = projectChannels("demo", [
      { id: "c2", key: "demo::c2", name: "releases" },
      { id: "c1", key: "demo::c1", name: "ci" },
      { id: "general", key: "x", name: "general" },
    ]);
    expect(channels.map((c) => c.name)).toStrictEqual(["general", "ci", "releases"]);
  });
});
