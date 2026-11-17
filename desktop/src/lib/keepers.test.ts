import { describe, expect, it } from "vitest";

import { keeperLiveItems } from "@/lib/liveActivity";
import type { KeeperTaskState } from "@/protocol";
import { finding, run } from "@/test/keepers";

import {
  activeKeepers,
  applyKeeperEvent,
  currentFindings,
  keeperAttentionReasons,
  keeperMark,
  keeperOn,
  keeperPushWarnings,
  keeperRuns,
  keepersEligible,
  keeperStatus,
  keeperWorst,
  latestDraft,
  missingPresets,
  normalizeKeeperState,
  outdatedRun,
  presetFile,
  readyKeepers,
  stripTone,
} from "./keepers";

const state = (fields: Partial<KeeperTaskState>): KeeperTaskState => ({
  ...normalizeKeeperState("t1", null),
  ...fields,
});

describe("ready keepers", () => {
  it("reads a draft as neither green nor red and keeps its text", () => {
    const draft = run({ draft: "TL;DR", id: "d1", outcome: "draft" });
    expect(keeperStatus(true, [draft], undefined, 0)).toBe("draft");
    expect(stripTone(draft)).toBe("grey");
    expect(latestDraft([draft])).toBe("TL;DR");
    expect(latestDraft([draft, run({ id: "g1" })])).toBeNull();
  });

  it("lists the ready keepers that are on, with whether one is running", () => {
    const def = (id: string, when: "commit" | "ready") =>
      ({ definition: { defaultOn: true, id, when } as never, id }) as const;
    const entries = [def("review", "commit"), def("intent", "ready"), def("verify", "ready")];
    const ready = readyKeepers(
      entries,
      state({
        runs: [run({ id: "i1", keeperId: "intent", outcome: null })],
        switches: { overrides: { verify: false } },
      }),
    );
    expect(ready.map(({ entry, running }) => [entry.id, running])).toEqual([["intent", true]]);
  });
});

describe("keeper status", () => {
  it("reads off, running, fixing, waiting and needs-you before the last outcome", () => {
    const green = [run({ id: "r1" })];
    expect(keeperStatus(false, green, undefined, 0)).toBe("off");
    expect(keeperStatus(true, [...green, run({ id: "r2", outcome: null })], undefined, 0)).toBe(
      "running",
    );
    const loop = { maxRounds: 3, rounds: 1 };
    expect(keeperStatus(true, green, { ...loop, status: "fixing" }, 0)).toBe("fixing");
    expect(keeperStatus(true, green, { ...loop, status: "waiting", reason: "dirty" }, 0)).toBe(
      "waiting",
    );
    expect(keeperStatus(true, green, { ...loop, status: "needs_you", stop: "max_rounds" }, 0)).toBe(
      "needs_you",
    );
    expect(keeperStatus(true, green, { ...loop, status: "idle" }, 0)).toBe("green");
    expect(keeperStatus(true, [], undefined, 0)).toBe("idle");
  });

  it("ignores superseded and skipped runs when reading the last outcome", () => {
    const runs = [
      run({ count: 2, id: "r1", outcome: "findings" }),
      run({ error: "superseded", id: "r2", outcome: "skipped" }),
      run({ error: "superseded", id: "r3", outcome: null }),
    ];
    expect(keeperStatus(true, runs, undefined, 2)).toBe("findings");
    expect(keeperStatus(true, [run({ id: "r4", outcome: "inconclusive" })], undefined, 0)).toBe(
      "inconclusive",
    );
  });

  it("reads a findings run with no open findings as quiet, not failing", () => {
    const superseded = [run({ count: 1, id: "r1", outcome: "findings" })];
    expect(keeperStatus(true, superseded, undefined, 0)).toBe("not_checked");
    expect(keeperStatus(true, superseded, undefined, 1)).toBe("findings");
  });

  it("keeps paused and superseded results neutral on cards and glyphs", () => {
    const runs = [run({ id: "green", outcome: "green" })];
    const paused = state({ runs, switches: { overrides: {}, held: "no branch" } });
    expect(keeperStatus(true, runs, undefined, 0, { state: paused })).toBe("not_checked");
    expect(activeKeepers(paused)[0].status).toBe("not_checked");
    expect(keeperWorst(paused)).toBe("not_checked");
    expect(keeperStatus(true, runs, undefined, 0, { unavailable: true })).toBe("not_checked");
    const failed = run({ id: "failed", outcome: "findings", count: 1 });
    const superseded = state({
      runs: [failed],
      findings: [finding({ id: "old", runId: failed.id, status: "superseded" })],
    });
    expect(activeKeepers(superseded)[0].status).toBe("not_checked");
  });

  it("follows the task's switch over the file's default", () => {
    const definition = { defaultOn: true } as never;
    expect(keeperOn("review", definition, undefined)).toBe(true);
    const off = state({ switches: { overrides: { review: false } } });
    expect(keeperOn("review", definition, off)).toBe(false);
    expect(keeperOn("slop", undefined, undefined)).toBe(false);
  });
});

describe("strip", () => {
  it("colours green, red, grey and in-flight runs", () => {
    expect(stripTone(run({ id: "a" }))).toBe("green");
    expect(stripTone(run({ count: 3, id: "b", outcome: "findings" }))).toBe("red");
    expect(stripTone(run({ id: "c", outcome: "inconclusive" }))).toBe("grey");
    expect(stripTone(run({ id: "d", outcome: "skipped" }))).toBe("grey");
    expect(stripTone(run({ error: "superseded", id: "e", outcome: null }))).toBe("grey");
    expect(stripTone(run({ id: "f", outcome: null }))).toBe("running");
  });

  it("orders a keeper's runs oldest first", () => {
    const s = state({
      runs: [
        run({ id: "b", startedAt: 5 }),
        run({ id: "x", keeperId: "slop" }),
        run({ id: "a", startedAt: 2 }),
      ],
    });
    expect(keeperRuns(s, "review").map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("findings", () => {
  it("lists the last counted run's open and sent findings, worst first", () => {
    const s = state({
      findings: [
        finding({ id: "old", runId: "r1" }),
        finding({ id: "low", runId: "r2", severity: "low" }),
        finding({ id: "crit", runId: "r2", severity: "critical", status: "sent" }),
        finding({ id: "gone", runId: "r2", status: "dismissed" }),
      ],
      runs: [
        run({ count: 1, id: "r1", outcome: "findings" }),
        run({ count: 2, id: "r2", outcome: "findings", startedAt: 2 }),
      ],
    });
    expect(currentFindings(s, keeperRuns(s, "review")).map((f) => f.id)).toEqual(["crit", "low"]);
  });
});

describe("task.keeper", () => {
  it("upserts the run, replaces its findings and sets the loop", () => {
    const before = state({
      findings: [finding({ id: "f1", runId: "r1" }), finding({ id: "f9", runId: "r9" })],
      runs: [run({ id: "r1", outcome: null })],
    });
    const after = applyKeeperEvent(before, {
      findings: [finding({ id: "f2", runId: "r1" })],
      keeper_id: "review",
      run: run({ count: 1, id: "r1", outcome: "findings" }),
      state: { maxRounds: 3, rounds: 0, status: "idle" },
      task_id: "t1",
    });
    expect(after.runs).toHaveLength(1);
    expect(after.runs[0].outcome).toBe("findings");
    expect(after.findings.map((f) => f.id)).toEqual(["f9", "f2"]);
    expect(after.loops.review.status).toBe("idle");
  });

  it("marks running keepers and those that need the owner, leaving off ones out", () => {
    const s = state({
      findings: [finding({ id: "f2", runId: "r2" })],
      loops: { slop: { maxRounds: 3, rounds: 3, status: "needs_you", stop: "max_rounds" } },
      runs: [
        run({ id: "r1", outcome: null }),
        run({ id: "r2", keeperId: "conventions", outcome: "findings", count: 2 }),
        run({ id: "r3", keeperId: "gone", outcome: null }),
      ],
      switches: { overrides: { gone: false } },
    });
    expect(activeKeepers(s).map(({ id, status }) => [id, status])).toEqual([
      ["conventions", "findings"],
      ["gone", "off"],
      ["review", "running"],
      ["slop", "needs_you"],
    ]);
  });

  it("warns a push about every keeper that is not green, and not about the green ones", () => {
    const s = state({
      findings: [finding({ id: "f2", runId: "r2" })],
      loops: { slop: { maxRounds: 3, rounds: 3, status: "needs_you", stop: "max_rounds" } },
      runs: [
        run({ id: "r1", outcome: null }),
        run({ id: "r2", keeperId: "conventions", outcome: "findings", count: 1 }),
        run({ id: "r3", keeperId: "intent", outcome: "green" }),
      ],
    });
    expect(keeperPushWarnings(s)).toEqual([
      "Conventions: 1 finding",
      "Review is still checking",
      "Slop needs you",
    ]);
    expect(keeperPushWarnings(undefined)).toEqual([]);
  });
});

describe("eligibility and presets", () => {
  const task = { kind: "task" as const, project: "p", tags: [], worktree: "/wt" };

  it("keeps keepers to tasks outside the Factory", () => {
    expect(keepersEligible(task)).toBe(true);
    expect(keepersEligible({ ...task, kind: "chat" })).toBe(false);
    expect(keepersEligible({ ...task, tags: ["runner"] })).toBe(false);
    expect(keepersEligible({ ...task, origin: "pr-review" })).toBe(false);
  });

  it("writes the two-line preset file and hides presets already added", () => {
    expect(presetFile("slop")).toEqual({
      content: "version: 1\npreset: slop\n",
      path: ".warpforge/keepers/slop.yaml",
    });
    const presets = [
      "review",
      "slop",
      "conventions",
      "security",
      "thermonuclear",
      "intent",
      "verify",
      "pr-ready",
    ].map((id) => ({ id, name: id, when: "commit" as const }));
    const entries = [{ id: "review" }, { definition: { preset: "slop" } as never, id: "my-slop" }];
    expect(missingPresets(entries, presets).map((p) => p.id)).toEqual([
      "conventions",
      "security",
      "thermonuclear",
      "intent",
      "verify",
      "pr-ready",
    ]);
  });
});

describe("keeper dot and attention", () => {
  const loop = { maxRounds: 3, rounds: 3 };
  const findings = run({ count: 2, id: "f", keeperId: "slop", outcome: "findings" });
  const checking = run({ id: "c", keeperId: "review", outcome: null });

  it("lets findings or a stopped loop beat a running check, and stays quiet when green", () => {
    expect(keeperWorst(undefined)).toBeNull();
    expect(keeperWorst(state({ runs: [run({ id: "g" })] }))).toBeNull();
    expect(keeperWorst(state({ runs: [checking] }))).toBe("running");
    const withFindings = state({
      findings: [finding({ id: "f2", runId: "f" })],
      runs: [checking, findings],
    });
    expect(keeperWorst(withFindings)).toBe("failing");
    const stopped = state({ loops: { review: { ...loop, status: "needs_you" } } });
    expect(keeperWorst(stopped)).toBe("failing");
    const offed = state({ runs: [findings], switches: { overrides: { slop: false } } });
    expect(keeperWorst(offed)).toBeNull();
  });

  it("does not read a run whose findings are all superseded as failing", () => {
    const s = state({
      findings: [finding({ id: "f1", runId: "f", status: "superseded" })],
      runs: [findings],
    });
    expect(activeKeepers(s).find((k) => k.id === "slop")).toEqual({
      findings: 0,
      id: "slop",
      outdated: false,
      status: "not_checked",
    });
    expect(keeperWorst(s)).toBe("not_checked");
    expect(keeperPushWarnings(s)).toEqual([]);
  });

  it("marks a fix in progress as checking and waiting findings as failing, on every surface", () => {
    expect(keeperMark({ findings: 2, status: "fixing" })).toBe("checking");
    expect(keeperMark({ findings: 2, status: "waiting" })).toBe("failing");
    expect(keeperMark({ findings: 0, status: "waiting" })).toBeNull();
    expect(keeperMark({ findings: 0, status: "green" })).toBeNull();
    const fixing = state({ loops: { slop: { ...loop, status: "fixing" } }, runs: [findings] });
    expect(keeperWorst(fixing)).toBe("running");
    expect(keeperLiveItems(fixing).map((item) => item.state)).toEqual(["running"]);
  });

  it("tells a run on the current HEAD from one on an older commit", () => {
    const ready = run({ id: "r", trigger: "ready" });
    const on = (head?: string) => state({ switches: { head, overrides: {} } });
    expect(outdatedRun(on("abcdef0123"), [ready])).toBeNull();
    expect(outdatedRun(on(undefined), [ready])).toBeNull();
    expect(outdatedRun(on("fedcba9876"), [])).toBeNull();
    expect(outdatedRun(on("fedcba9876"), [ready])).toEqual({ ready: true, sha: "abcdef0" });
    expect(outdatedRun(on("fedcba9876"), [run({ id: "c" })])).toEqual({
      ready: false,
      sha: "abcdef0",
    });
  });

  it("reads a ready keeper's findings on an older commit as advice, not failing", () => {
    const ready = run({ count: 2, id: "f", keeperId: "intent", outcome: "findings" });
    const s = (head: string, trigger: "ready" | "commit") =>
      state({
        findings: [finding({ id: "f1", runId: "f" })],
        runs: [{ ...ready, trigger }],
        switches: { head, overrides: {} },
      });
    expect(keeperWorst(s("fedcba9876", "ready"))).toBeNull();
    expect(keeperPushWarnings(s("fedcba9876", "ready"))).toEqual([]);
    expect(keeperLiveItems(s("fedcba9876", "ready"))).toEqual([]);
    expect(keeperWorst(s("abcdef0123", "ready"))).toBe("failing");
    expect(keeperPushWarnings(s("abcdef0123", "ready"))).toEqual(["Intent: 1 finding"]);
    expect(keeperWorst(s("fedcba9876", "commit"))).toBe("failing");
    expect(keeperMark({ findings: 2, outdated: true, status: "findings" })).toBeNull();
    expect(keeperMark({ findings: 2, outdated: true, status: "needs_you" })).toBe("failing");
  });

  it("asks the owner only for keepers whose loop stopped, not for findings being fixed", () => {
    const fixing = state({ loops: { slop: { ...loop, status: "fixing" } }, runs: [findings] });
    const one = state({ loops: { review: { ...loop, status: "needs_you" } } });
    const two = state({
      loops: { review: { ...loop, status: "needs_you" }, slop: { ...loop, status: "needs_you" } },
    });
    expect([...keeperAttentionReasons({ fixing, one, two })]).toEqual([
      ["one", "Review keeper needs your decision"],
      ["two", "Review, Slop keepers need your decision"],
    ]);
    expect(keeperAttentionReasons(undefined).size).toBe(0);
  });
});
