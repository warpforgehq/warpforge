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
vi.mock("../views/Memory", () => {
  loaded.push("memory");
  return { default: () => null };
});
vi.mock("../views/NewTaskDialog", () => {
  loaded.push("new-task-composer");
  return { default: () => null };
});
vi.mock("../views/Projects", () => {
  loaded.push("projects");
  return { default: () => null };
});
vi.mock("../views/settings", () => {
  loaded.push("settings");
  return { default: () => null };
});
vi.mock("../views/TaskDetail", () => {
  loaded.push("task-detail");
  return { default: () => null };
});
vi.mock("../views/Team", () => {
  loaded.push("team");
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
          "memory",
          "new-task-composer",
          "projects",
          "settings",
          "task-detail",
          "team",
        ]),
      );
    });
    expect(loaded).toHaveLength(8);
  });
});
