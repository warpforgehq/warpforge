import { describe, expect, it } from "vitest";

import type { KeeperTaskState } from "@/protocol";
import { finding, run } from "@/test/keepers";

import {
  activeKeepers,
  keeperPushWarnings,
  applyKeeperEvent,
  currentFindings,
  keeperOn,
  keeperRuns,
  keepersEligible,
  keeperStatus,
  missingPresets,
  normalizeKeeperState,
  presetFile,
  stripTone,
} from "./keepers";

const state = (fields: Partial<KeeperTaskState>): KeeperTaskState => ({
  ...normalizeKeeperState("t1", null),
  ...fields,
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
    expect(missingPresets(entries).map((p) => p.id)).toEqual(["conventions"]);
  });
});
