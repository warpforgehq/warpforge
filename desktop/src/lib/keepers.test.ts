import { describe, expect, it } from "vitest";

import type { KeeperTaskState } from "@/protocol";
import { finding, run } from "@/test/keepers";

import {
  activeKeepers,
  keeperPushWarnings,
  applyKeeperEvent,
  currentFindings,
  keeperAttentionReasons,
  keeperOn,
  keeperRuns,
  keepersEligible,
  keeperStatus,
  latestDraft,
  missingPresets,
  normalizeKeeperState,
  presetFile,
  readyKeepers,
  stripTone,
  keeperWorst,
} from "./keepers";

const state = (fields: Partial<KeeperTaskState>): KeeperTaskState => ({
  ...normalizeKeeperState("t1", null),
  ...fields,
});

describe("ready keepers", () => {
  it("reads a draft as neither green nor red and keeps its text", () => {
    const draft = run({ draft: "TL;DR", id: "d1", outcome: "draft" });
    expect(keeperStatus(true, [draft], undefined)).toBe("draft");
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
    expect(keeperStatus(false, green, undefined)).toBe("off");
    expect(keeperStatus(true, [...green, run({ id: "r2", outcome: null })], undefined)).toBe(
      "running",
    );
    const loop = { maxRounds: 3, rounds: 1 };
    expect(keeperStatus(true, green, { ...loop, status: "fixing" })).toBe("fixing");
    expect(keeperStatus(true, green, { ...loop, status: "waiting", reason: "dirty" })).toBe(
      "waiting",
    );
    expect(keeperStatus(true, green, { ...loop, status: "needs_you", stop: "max_rounds" })).toBe(
      "needs_you",
    );
    expect(keeperStatus(true, green, { ...loop, status: "idle" })).toBe("green");
    expect(keeperStatus(true, [], undefined)).toBe("idle");
  });

  it("ignores superseded and skipped runs when reading the last outcome", () => {
    const runs = [
      run({ count: 2, id: "r1", outcome: "findings" }),
      run({ error: "superseded", id: "r2", outcome: "skipped" }),
      run({ error: "superseded", id: "r3", outcome: null }),
    ];
    expect(keeperStatus(true, runs, undefined)).toBe("findings");
    expect(keeperStatus(true, [run({ id: "r4", outcome: "inconclusive" })], undefined)).toBe(
      "inconclusive",
    );
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
    const entries = [{ id: "review" }, { definition: { preset: "slop" } as never, id: "my-slop" }];
    expect(missingPresets(entries).map((p) => p.id)).toEqual([
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
    expect(keeperWorst(state({ runs: [checking, findings] }))).toBe("failing");
    const stopped = state({ loops: { review: { ...loop, status: "needs_you" } } });
    expect(keeperWorst(stopped)).toBe("failing");
    const offed = state({ runs: [findings], switches: { overrides: { slop: false } } });
    expect(keeperWorst(offed)).toBeNull();
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
