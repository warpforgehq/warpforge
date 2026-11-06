import { afterEach, describe, expect, it, vi } from "vitest";

import type { DaemonEvent } from "../protocol";
import { run } from "../test/keepers";
import { daemon } from "./index";

type Internals = { applyEvent: (event: DaemonEvent) => void };

afterEach(() => vi.restoreAllMocks());

describe("keeper RPCs", () => {
  it("calls the keepers methods with snake_case params and refreshes the task", async () => {
    const request = vi.spyOn(daemon, "request").mockResolvedValue({ runs: [] });
    await daemon.dismissKeeperFinding("t1", "f1", "  ");
    await daemon.decideKeeper("t1", "review", "extend", { note: "keep API", rounds: 2 });
    await daemon.decideKeeper("t1", "review", "accept", { note: "ignored", rounds: 9 });
    await daemon.setKeeperSwitch("t1", "review", false);
    await daemon.sendKeeperFindings("t1", "review");
    await daemon.addKeeper("demo", "review");
    const calls = request.mock.calls.filter(([method]) => method !== "keepers.state");
    expect(calls).toEqual([
      ["keepers.dismiss", { finding_id: "f1", reason: null, task_id: "t1" }],
      [
        "keepers.decide",
        { decision: "extend", keeper_id: "review", note: "keep API", rounds: 2, task_id: "t1" },
      ],
      [
        "keepers.decide",
        { decision: "accept", keeper_id: "review", note: null, rounds: null, task_id: "t1" },
      ],
      ["keepers.setSwitch", { keeper_id: "review", on: false, task_id: "t1" }],
      ["keepers.sendFindings", { keeper_id: "review", task_id: "t1" }],
      [
        "file.save",
        {
          content: "version: 1\npreset: review\n",
          path: ".warpforge/keepers/review.yaml",
          project: "demo",
          task_id: "",
        },
      ],
    ]);
    expect(daemon.getState().taskKeepers?.t1.runs).toEqual([]);
  });

  it("asks again when a task.keeper event lands while keepers.state is in flight", async () => {
    let calls = 0;
    vi.spyOn(daemon, "request").mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        (daemon as unknown as Internals).applyEvent({
          data: {
            findings: [],
            keeper_id: "review",
            run: run({ id: "new", taskId: "t2" }),
            state: { maxRounds: 3, rounds: 0, status: "idle" },
            task_id: "t2",
          },
          event: "task.keeper",
        });
        return { runs: [] };
      }
      return { runs: [run({ id: "new", taskId: "t2" })] };
    });
    await daemon.refreshTaskKeepers("t2");
    expect(calls).toBe(2);
    expect(daemon.getState().taskKeepers?.t2.runs.map((r) => r.id)).toEqual(["new"]);
  });
});
