import { describe, expect, it } from "vitest";

import type { PeerMessage, TaskInfo } from "@/protocol";
import { smithFixture } from "@/test/smiths";

import {
  applyMention,
  buildConversations,
  continuesGroup,
  isPeerVisible,
  isSmithInternal,
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

describe("continuesGroup", () => {
  const post = (overrides: Partial<PeerMessage>): PeerMessage => ({
    createdAt: 1000,
    fromTask: "t_a",
    id: 1,
    project: "demo",
    status: "posted",
    text: "x",
    ...overrides,
  });

  it("groups the same sender's posts a few minutes apart", () => {
    expect(continuesGroup(post({}), post({ createdAt: 1200, id: 2 }))).toBe(true);
  });

  it("starts a new group for another sender, a long gap, a new status or a live alert", () => {
    const first = post({});
    expect(continuesGroup(undefined, first)).toBe(false);
    expect(continuesGroup(first, post({ fromTask: "t_b", id: 2 }))).toBe(false);
    expect(continuesGroup(first, post({ createdAt: 1000 + 301, id: 2 }))).toBe(false);
    expect(continuesGroup(first, post({ id: 2, status: "refused" }))).toBe(false);
    expect(continuesGroup(first, post({ alert: true, id: 2 }))).toBe(false);
  });
});

describe("a Smith's messages to its own sessions", () => {
  const tasks = new Map(
    [
      task("t_oly", "thread", { origin: "smith", smithId: "sm_oly" }),
      task("t_work", "Test task: git pull and report", { smithId: "sm_oly" }),
      task("t_ada", "thread", { origin: "smith", smithId: "sm_ada" }),
      task("t_plain", "Docs"),
    ].map((t) => [t.id, t]),
  );

  it("are internal only between one Smith's thread and its work", () => {
    expect(isSmithInternal(record(1, { fromTask: "t_work", toTask: "t_oly" }), tasks)).toBe(true);
    expect(isSmithInternal(record(2, { fromTask: "t_oly", toTask: "t_work" }), tasks)).toBe(true);
    expect(isSmithInternal(record(3, { fromTask: "t_oly", toTask: "t_ada" }), tasks)).toBe(false);
    expect(isSmithInternal(record(4, { fromTask: "t_work", toTask: "t_plain" }), tasks)).toBe(
      false,
    );
    expect(isSmithInternal(record(5, { fromTask: undefined, toTask: "t_work" }), tasks)).toBe(
      false,
    );
  });

  it("make no direct conversation when the tasks are known", () => {
    const records = [
      record(1, { fromTask: "t_work", toTask: "t_oly" }),
      record(2, { fromTask: "t_oly", toTask: "t_work" }),
      record(3, { fromTask: "t_oly", toTask: "t_ada" }),
      record(4, { fromTask: undefined, toTask: "t_work" }),
    ];
    const keys = (list: ReturnType<typeof buildConversations>) =>
      list.map((c) => c.parties?.join("|"));
    expect(keys(buildConversations(records, "demo", tasks))).toEqual(["|t_work", "t_oly|t_ada"]);
    expect(buildConversations(records, "demo")).toHaveLength(3);
  });
});

describe("records that outlive their sessions", () => {
  const none = new Map<string, TaskInfo>();

  it("stay internal by the Smiths they stored, with both tasks gone", () => {
    const report = record(1, {
      fromSmithId: "sm_oly",
      fromTask: "t_bf9db30d",
      toSmithId: "sm_oly",
      toTask: "t_oly",
    });
    expect(isSmithInternal(report, none)).toBe(true);
    expect(buildConversations([report], "demo", none)).toEqual([]);
    const other = record(2, { fromSmithId: "sm_oly", fromTask: "t_x", toSmithId: "sm_ada" });
    expect(isSmithInternal(other, none)).toBe(false);
  });

  it("guess an older start_work report as internal only when nothing is known", () => {
    const old = record(3, {
      fromTask: "t_06cf5c75",
      text: 'Work session "Test task" (t_06cf5c75) finished a turn; 0 files changed.',
      toTask: "t_oly",
    });
    expect(isSmithInternal(old, none)).toBe(true);
    expect(isSmithInternal({ ...old, text: "hello" }, none)).toBe(false);
  });
});

describe("the Direct list", () => {
  const tasks = new Map(
    [
      task("t_oly", "thread", { origin: "smith", smithId: "sm_oly" }),
      task("t_ada", "thread", { origin: "smith", smithId: "sm_ada" }),
      task("t_done", "Settled work", { status: "done" }),
    ].map((t) => [t.id, t]),
  );
  const parties = (list: ReturnType<typeof buildConversations>) =>
    list.map((c) => c.parties?.join("|"));

  it("drops a conversation once either side is deleted, whatever it stored", () => {
    const records = [
      record(1, { fromLabel: "Bo · x", fromTask: "t_gone", text: "hi", toTask: "t_oly" }),
      record(2, { fromTask: "t_oly", toLabel: "Bo · y", toTask: "t_gone2" }),
      record(3, { fromTask: undefined, toTask: "t_gone3" }),
      record(4, { fromTask: "t_done", toTask: "t_ada" }),
      record(5, { fromTask: undefined, toTask: "t_ada" }),
    ];
    expect(parties(buildConversations(records, "demo", tasks))).toEqual(["|t_ada", "t_done|t_ada"]);
  });

  it("keeps one conversation for a pair, whoever wrote first", () => {
    const records = [
      record(1, { fromTask: "t_oly", toTask: "t_ada" }),
      record(2, { fromTask: "t_ada", toTask: "t_oly" }),
    ];
    const list = buildConversations(records, "demo", tasks);
    expect(list).toHaveLength(1);
    expect(list[0]!.records.map((r) => r.id)).toEqual([1, 2]);
  });

  it("still leaves out a Smith's talk with its own session", () => {
    const work = task("t_work", "Test task", { smithId: "sm_oly" });
    const all = new Map([...tasks, [work.id, work]]);
    const records = [record(1, { fromTask: "t_work", toTask: "t_oly" })];
    expect(buildConversations(records, "demo", all)).toEqual([]);
  });
});
