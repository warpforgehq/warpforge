import { describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => [] as string[]);

vi.mock("../views/Automations", () => {
  loaded.push("automations");
  return { default: () => null };
});
vi.mock("../views/InboxView", () => {
  loaded.push("inbox");
  return { default: () => null };
});
vi.mock("../views/MissionControl", () => {
  loaded.push("mission-control");
  return { default: () => null };
});
vi.mock("../views/Projects", () => {
  loaded.push("projects");
  return { default: () => null };
});
vi.mock("../views/TaskDetail", () => {
  loaded.push("task-detail");
  return { default: () => null };
});

import { prefetchRouteChunks } from "./routePrefetch";

describe("prefetchRouteChunks", () => {
  it("loads every lazy route, so no first visit waits on a chunk", async () => {
    prefetchRouteChunks();

    await vi.waitFor(() => {
      expect(loaded).toEqual(
        expect.arrayContaining([
          "automations",
          "inbox",
          "mission-control",
          "projects",
          "task-detail",
        ]),
      );
    });
    expect(loaded).toHaveLength(5);
  });
});
