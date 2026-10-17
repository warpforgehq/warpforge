import { describe, expect, it } from "vitest";

import type { PeerMessage, TaskInfo } from "@/protocol";

import {
  applyMention,
  buildConversations,
  isPeerVisible,
  mentionAtCaret,
  mentionCandidates,
  mentionText,
  peerAlertReasons,
  rankCandidates,
  unreadCount,
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
