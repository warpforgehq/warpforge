import { describe, expect, it } from "vitest";

import type { Smith, TaskInfo } from "@/protocol";

import {
  assigneeLabel,
  smithAssignee,
  smithIdFromAssignee,
  smithNameError,
  smithStatus,
  smithWorkSessions,
} from "./smiths";

function smith(overrides: Partial<Smith> = {}): Smith {
  return {
    agent: "claude",
    allowedProjects: ["demo"],
    budget: {},
    charterRev: "c1",
    createdAt: 1,
    homeProject: "demo",
    id: "sm_1",
    name: "Ada",
    permissions: { createPr: false, push: false, writePaths: [] },
    soulRev: "s1",
    threadTaskId: "t_thread",
    ...overrides,
  };
}

function task(id: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    agent: "claude",
    createdAt: 1,
    id,
    project: "demo",
    prompt: id,
    status: "waiting",
    tags: [],
    title: id,
    updatedAt: 1,
    ...overrides,
  } as TaskInfo;
}

describe("smithNameError", () => {
  it.each(["Ada", "ada-2", "Оля", "R2_d2", "a".repeat(32)])("accepts %s", (name) => {
    expect(smithNameError(name)).toBeNull();
  });

  it.each([
    ["", "needs a name"],
    ["2ada", "Start the name with a letter"],
    ["Ada Lovelace", "one word"],
    ["ada@x", "one word"],
    ["a".repeat(33), "32 characters"],
  ])("refuses %j", (name, message) => {
    expect(smithNameError(name)).toContain(message);
  });

  it("refuses a name another teammate has, in any case", () => {
    expect(smithNameError("ADA", [smith()])).toContain("already a teammate");
  });
});

describe("assignees", () => {
  const smiths = { sm_1: smith() };

  it("round-trips a Smith's id, never its name", () => {
    expect(smithAssignee("sm_1")).toBe("smith:sm_1");
    expect(smithIdFromAssignee("smith:sm_1")).toBe("sm_1");
    expect(smithIdFromAssignee("octocat")).toBeNull();
  });

  it("shows a Smith by name, a gone one as removed, a person as written", () => {
    expect(assigneeLabel("smith:sm_1", smiths)).toBe("Ada");
    expect(assigneeLabel("smith:sm_gone", smiths)).toBe("Removed teammate");
    expect(assigneeLabel("octocat", smiths)).toBe("octocat");
    expect(assigneeLabel(null, smiths)).toBeNull();
  });
});

describe("smithStatus", () => {
  it("is held with its reasons before anything else", () => {
    const status = smithStatus(smith({ held: ["identity_changed", "paused"] }), [
      task("t_w", { smithId: "sm_1", status: "running" }),
    ]);
    expect(status).toStrictEqual({
      kind: "held",
      reasons: ["its soul or charter was edited outside Warpforge", "paused"],
    });
  });

  it("is working while a session of it runs, otherwise idle", () => {
    const tasks = [
      task("t_thread", { smithId: "sm_1", status: "running" }),
      task("t_done", { smithId: "sm_1", status: "done" }),
      task("t_open", { smithId: "sm_1" }),
    ];
    expect(smithStatus(smith(), tasks)).toStrictEqual({ kind: "working", sessions: 1 });
    expect(smithWorkSessions(smith(), tasks).map((t) => t.id)).toStrictEqual(["t_open"]);
    expect(smithStatus(smith(), [task("t_x")])).toStrictEqual({ kind: "idle" });
  });
});
