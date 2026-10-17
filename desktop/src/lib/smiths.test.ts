import { describe, expect, it } from "vitest";

import type { Smith, TaskInfo } from "@/protocol";

import {
  assigneeLabel,
  endedTurns,
  injectionNote,
  smithAssignee,
  smithIdFromAssignee,
  smithNameError,
  smithStatus,
  smithUnread,
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

describe("injectionNote", () => {
  it("says how the soul is delivered, with the upgrade hint only for Claude on a prefix", () => {
    expect(injectionNote({ agent: "claude", injection: "system_prompt" })).toBe(
      "Soul delivered as system prompt",
    );
    expect(injectionNote({ agent: "claude", injection: "prefix" })).toContain("0.91");
    expect(injectionNote({ agent: "codex", injection: "prefix" })).toBe(
      "Soul delivered as opening message",
    );
    expect(injectionNote({ agent: "claude" })).toBeNull();
  });
});

describe("smithUnread", () => {
  const ada = smith();
  const record = (id: number, fromTask: string, createdAt: number) => ({
    createdAt,
    fromTask,
    id,
    project: "demo",
    status: "delivered" as const,
    text: "",
  });

  it("counts replies since the page was open and its sessions' newer feed records", () => {
    const tasks = [task("t_work", { smithId: "sm_1" }), task("t_other")];
    const records = [
      record(1, "t_thread", 50),
      record(2, "t_thread", 150),
      record(3, "t_work", 160),
      record(4, "t_other", 170),
    ];
    expect(smithUnread(ada, records, tasks, 100, 2)).toBe(4);
    expect(smithUnread(ada, records, tasks, 200, 0)).toBe(0);
  });

  it("counts ended turns in a transcript", () => {
    expect(
      endedTurns([
        { kind: "agent_text", text: "hi" },
        { kind: "turn_ended", stop_reason: "end_turn" },
        { kind: "turn_ended", stop_reason: "end_turn" },
      ]),
    ).toBe(2);
  });
});
