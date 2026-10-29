import { describe, expect, it } from "vitest";

import { buildTaskForest } from "@/lib/taskGroups";
import type { TaskInfo } from "@/protocol";

import { buildSidebarRows, CHATS_GROUP } from ".";

const NOW = 1_700_000_000;

function task(id: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    agent: "codex",
    blockedReason: null,
    createdAt: 1,
    filesChanged: 0,
    id,
    project: "warpforge",
    prompt: id,
    status: "waiting",
    tags: [],
    title: "",
    updatedAt: 1,
    ...overrides,
  };
}

const chat = (id: string) => task(id, { kind: "chat", project: "" });

function build(tasks: TaskInfo[], projectOrder = ["warpforge"], collapsed: string[] = []) {
  return buildSidebarRows({
    activePathIds: new Set(),
    collapsedProjects: new Set(collapsed),
    expandedShelves: new Set(),
    expandedTaskIds: new Set(),
    forceVisibleTaskIds: new Set(),
    forest: buildTaskForest(tasks),
    nowSec: NOW,
    projectOrder,
    queue: [],
    selectedProject: null,
    tasks,
  });
}

describe("chats in the sidebar", () => {
  it("lists chats under their own group after the projects", () => {
    const rows = build([task("a"), chat("c1"), chat("c2")]);
    expect(rows.map((row) => row.key)).toEqual([
      "project:warpforge",
      "workspace:a",
      "chats",
      "workspace:c1",
      "workspace:c2",
    ]);
    expect(rows.find((row) => row.kind === "chats")).toMatchObject({ count: 2, expanded: true });
  });

  it("shows chats even before any project exists", () => {
    const rows = build([chat("c1")], []);
    expect(rows.map((row) => row.key)).toEqual(["empty:workspace", "chats", "workspace:c1"]);
  });

  it("folds the group and leaves no header without chats", () => {
    expect(build([chat("c1")], [], [CHATS_GROUP]).map((row) => row.key)).toEqual([
      "empty:workspace",
      "chats",
    ]);
    expect(build([task("a")]).some((row) => row.kind === "chats")).toBe(false);
  });
});
