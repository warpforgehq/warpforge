import { describe, expect, it } from "vitest";

import type { PeerMessage, TaskInfo } from "@/protocol";
import { smithFixture } from "@/test/smiths";

import {
  applyMention,
  buildConversations,
  isPeerVisible,
  mentionAtCaret,
  mentionCandidates,
  mentionText,
  peerLabel,
  peerAlertReasons,
  rankCandidates,
  unreadCount,
  userThread,
  userWritesIn,
} from "./peerFeed";

function record(id: number, overrides: Partial<PeerMessage> = {}): PeerMessage {
  return {
    createdAt: 100 + id,
    fromTask: "t_a",
    id,
    project: "demo",
    status: "delivered",
    text: `message ${id}`,
    toTask: "t_b",
    ...overrides,
  };
}

function task(id: string, title: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    agent: "claude",
    createdAt: 1,
    id,
    project: "demo",
    prompt: title,
    status: "waiting",
    tags: [],
    title,
    updatedAt: 1,
    ...overrides,
  } as TaskInfo;
}

describe("buildConversations", () => {
  it("files both directions of a pair in one thread, oldest first", () => {
    const threads = buildConversations([
      record(3, { fromTask: "t_b", toTask: "t_a" }),
      record(1),
      record(2, { status: "posted", toTask: undefined }),
      record(4, { fromTask: undefined, toTask: "t_a" }),
    ]);
    expect(threads.map((t) => t.kind)).toStrictEqual(["dm", "dm", "team"]);
    const pair = threads.find((t) => t.records.some((r) => r.id === 3))!;
    expect(pair.records.map((r) => r.id)).toStrictEqual([1, 3]);
    expect(threads[0]!.parties).toStrictEqual([null, "t_a"]);
  });

  it("keeps only the filtered project", () => {
    const threads = buildConversations([record(1), record(2, { project: "other" })], "other");
    expect(threads.map((t) => t.project)).toStrictEqual(["other"]);
  });
});

describe("unreadCount", () => {
  it("counts newer records that the user did not send", () => {
    const records = [
      record(1, { createdAt: 50 }),
      record(2, { createdAt: 150 }),
      record(3, { createdAt: 160, fromTask: undefined }),
    ];
    expect(unreadCount(records, 100)).toBe(1);
  });
});

describe("peerAlertReasons", () => {
  it("names the pair on the task whose message tripped the window, while live", () => {
    const label = (id: string) => (id === "t_a" ? "Fix login" : "Docs");
    const reasons = peerAlertReasons(
      [
        record(1, { alert: true, status: "refused" }),
        record(2, { alert: true, alertClearedAt: 200, fromTask: "t_c", status: "refused" }),
      ],
      label,
    );
    expect([...reasons]).toStrictEqual([
      ["t_a", "sessions Fix login and Docs hit the message limit"],
    ]);
  });
});

describe("mentions", () => {
  const candidates = [
    { id: "t_11111111", label: "Fix login" },
    { id: "t_22222222", label: "Docs" },
    { id: "t_33333333", label: "Docs" },
  ];

  it("finds the mention being typed, spaces included, only at a word start", () => {
    expect(mentionAtCaret("ask @Fix lo", 11)).toStrictEqual({ query: "Fix lo", start: 4 });
    expect(mentionAtCaret("mail me@x", 9)).toBeNull();
    expect(mentionAtCaret("see (@fi", 8)).toStrictEqual({ query: "fi", start: 5 });
    expect(mentionAtCaret("a/@fi", 5)).toStrictEqual({ query: "fi", start: 2 });
    expect(mentionAtCaret("@@fi", 4)).toBeNull();
    expect(mentionAtCaret("@a\nb", 4)).toBeNull();
    expect(mentionAtCaret("no mention", 10)).toBeNull();
  });

  it("ranks label prefixes first and drops non-matches", () => {
    expect(rankCandidates(candidates, "do").map((c) => c.id)).toStrictEqual([
      "t_22222222",
      "t_33333333",
    ]);
    expect(rankCandidates(candidates, "login")[0]!.id).toBe("t_11111111");
    expect(rankCandidates(candidates, "zzz")).toStrictEqual([]);
  });

  it("inserts a label when it is unique and the id when it is not", () => {
    expect(mentionText(candidates[0]!, candidates)).toBe("@Fix login");
    expect(mentionText(candidates[1]!, candidates)).toBe("@t_22222222");
  });

  it("replaces the typed mention and moves the caret after it", () => {
    const text = "ask @fi now";
    const mention = mentionAtCaret(text, 7)!;
    expect(applyMention(text, mention, 7, "@Fix login")).toStrictEqual({
      caret: 15,
      text: "ask @Fix login  now",
    });
  });

  it("offers only the project's visible sessions", () => {
    const tasks = [
      task("t_1", "Fix login"),
      task("t_2", "Child", { parentTaskId: "t_1" }),
      task("t_3", "Done", { status: "done" }),
      task("t_4", "Elsewhere", { project: "other" }),
      task("t_5", "Run", { tags: ["automation"] }),
    ];
    expect(isPeerVisible(tasks[0]!)).toBe(true);
    expect(mentionCandidates(tasks, "demo").map((c) => c.id)).toStrictEqual(["t_1"]);
  });
});

describe("user threads", () => {
  it("names the same thread a user's direct message lands in", () => {
    const [thread] = buildConversations([record(1, { fromTask: undefined, toTask: "t_b" })]);
    expect(userThread("demo", "t_b").key).toBe(thread!.key);
    expect(userWritesIn(thread!)).toBe(true);
    expect(userWritesIn(buildConversations([record(2)])[0]!)).toBe(false);
  });
});

describe("Smiths in mentions and labels", () => {
  const ada = smithFixture({ allowedProjects: ["demo"], homeProject: "demo" });

  it("names a Smith's thread by its name and its work as Name · title", () => {
    const smiths = { sm_1: ada };
    expect(peerLabel(task("t_thread", "thread", { smithId: "sm_1" }), smiths)).toBe("Ada");
    expect(peerLabel(task("t_w", "Fix flake", { smithId: "sm_1" }), smiths)).toBe(
      "Ada · Fix flake",
    );
    expect(peerLabel(task("t_x", "Plain"), smiths)).toBe("Plain");
  });

  it("offers a Smith by name where it may work, and a session named like it by id only", () => {
    const tasks = [
      task("t_thread", "thread", { origin: "smith", smithId: "sm_1" }),
      task("t_w", "Fix flake", { smithId: "sm_1" }),
      task("t_same", "ada"),
    ];
    const candidates = mentionCandidates(tasks, "demo", [ada]);
    expect(candidates).toStrictEqual([
      { id: "t_same", label: "" },
      { id: "t_thread", label: "Ada", smith: true },
      { id: "t_w", label: "Ada · Fix flake" },
    ]);
    expect(mentionCandidates(tasks, "other", [ada]).some((c) => c.smith)).toBe(false);
  });
});

describe("named channels", () => {
  it("gives each channel its own thread, #general the project's", () => {
    const threads = buildConversations([
      record(1, { channelId: "c1", status: "posted", toTask: undefined }),
      record(2, { status: "posted", toTask: undefined }),
    ]);
    expect(threads.map((t) => [t.key, t.channelId])).toStrictEqual([
      ["demo::team", undefined],
      ["demo::ch::c1", "c1"],
    ]);
  });
});
