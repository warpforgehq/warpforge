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

function build(tasks: TaskInfo[], projectOrder = ["warpforge"], chats = false) {
  return buildSidebarRows({
    activePathIds: new Set(),
    chats,
    collapsedProjects: new Set(),
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
  it("keeps chats out of the Tasks list", () => {
    const rows = build([task("a"), chat("c1"), chat("c2")]);
    expect(rows.map((row) => row.key)).toEqual(["project:warpforge", "workspace:a"]);
  });

  it("lists only chats in the Chats list, flat and newest first", () => {
    const rows = build(
      [task("a"), { ...chat("old"), updatedAt: 1 }, { ...chat("new"), updatedAt: 5 }],
      ["warpforge"],
      true,
    );
    expect(rows.map((row) => row.key)).toEqual(["workspace:new", "workspace:old"]);
  });

  it("shelves finished chats under the chats group", () => {
    const rows = build([{ ...chat("done"), status: "done" }], [], true);
    expect(rows.map((row) => row.key)).toEqual([`shelf:${CHATS_GROUP}`]);
  });

  it("shows one quiet line without chats", () => {
    expect(build([task("a")], ["warpforge"], true)).toEqual([
      { hint: null, key: "empty:chats", kind: "empty", label: "No chats yet" },
    ]);
  });

  it("offers to add a project when only chats exist", () => {
    expect(build([chat("c1")], []).map((row) => row.key)).toEqual(["empty:workspace"]);
  });
});
