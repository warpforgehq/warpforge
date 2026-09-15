import { describe, expect, it } from "vitest";

import {
  boardTasks,
  closedPrAssistantTasks,
  findPrAssistantTask,
  isPrAssistantRunning,
  prAssistantTaskIndex,
  prTaskTag,
} from "@/lib/taskOrigin";
import type { PullRequestSummary, TaskInfo } from "@/protocol";

function task(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id: "t1",
    project: "warpforge",
    prompt: "do the thing",
    agent: "claude",
    status: "waiting",
    tags: [],
    title: "Do the thing",
    createdAt: 1,
    updatedAt: 1,
    filesChanged: 0,
    blockedReason: null,
    ...overrides,
  };
}

function pr(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    project: "warpforge",
    repo: "acme/widgets",
    number: 7,
    title: "Add widget",
    url: "https://github.test/pull/7",
    state: "open",
    draft: false,
    labels: [],
    assignees: [],
    baseRefName: "main",
    headRefName: "widget",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("boardTasks", () => {
  it("keeps the board's own work and drops what a surface owns", () => {
    const mine = task();
    const shadow = task({ id: "t2", origin: "pr-review" });
    expect(boardTasks([mine, shadow])).toEqual([mine]);
  });
});

describe("findPrAssistantTask", () => {
  it("finds the conversation for one pull request", () => {
    const shadow = task({ id: "t2", origin: "pr-review", tags: ["pr:acme/widgets#7"] });
    const other = task({ id: "t3", origin: "pr-review", tags: ["pr:acme/widgets#9"] });
    expect(findPrAssistantTask([task(), other, shadow], pr())?.id).toBe("t2");
  });

  it("does not mistake a board task with the same tag for one", () => {
    // The tag alone is not the marker — origin is, so a user tagging their own
    // task `pr:…` cannot have the Assistant hijack it.
    const impostor = task({ tags: ["pr:acme/widgets#7"] });
    expect(findPrAssistantTask([impostor], pr())).toBeNull();
  });

  it("resolves to the newest when two exist", () => {
    const first = task({
      id: "t2",
      origin: "pr-review",
      tags: ["pr:acme/widgets#7"],
      createdAt: 1,
    });
    const second = task({
      id: "t3",
      origin: "pr-review",
      tags: ["pr:acme/widgets#7"],
      createdAt: 2,
    });
    expect(findPrAssistantTask([first, second], pr())?.id).toBe("t3");
  });
});

describe("prAssistantTaskIndex", () => {
  it("indexes shadow tasks by PR tag, newest winning, board tasks excluded", () => {
    const first = task({
      id: "t2",
      origin: "pr-review",
      tags: ["pr:acme/widgets#7"],
      createdAt: 1,
    });
    const second = task({
      id: "t3",
      origin: "pr-review",
      tags: ["pr:acme/widgets#7"],
      createdAt: 2,
    });
    const other = task({
      id: "t4",
      origin: "pr-review",
      tags: ["pr:acme/widgets#9"],
      createdAt: 3,
    });
    const board = task({ id: "t5", tags: ["pr:acme/widgets#7"], createdAt: 4 });

    const index = prAssistantTaskIndex([first, second, other, board]);

    expect(index.get("pr:acme/widgets#7")?.id).toBe("t3");
    expect(index.get("pr:acme/widgets#9")?.id).toBe("t4");
    expect(index.size).toBe(2);
  });

  it("is memoized against the tasks array's identity, so rows do not rescan", () => {
    const tasks = [task({ id: "t2", origin: "pr-review", tags: ["pr:acme/widgets#7"] })];
    const first = prAssistantTaskIndex(tasks);
    expect(prAssistantTaskIndex(tasks)).toBe(first);

    const copy = [...tasks];
    const rebuilt = prAssistantTaskIndex(copy);
    expect(rebuilt).not.toBe(first);
    expect(prAssistantTaskIndex(copy)).toBe(rebuilt);
  });
});

describe("isPrAssistantRunning", () => {
  it("counts queued and running, and nothing else", () => {
    expect(isPrAssistantRunning(task({ status: "queued" }))).toBe(true);
    expect(isPrAssistantRunning(task({ status: "running" }))).toBe(true);
    for (const status of ["waiting", "blocked", "interrupted", "done"] as const) {
      expect(isPrAssistantRunning(task({ status }))).toBe(false);
    }
  });
});

describe("closedPrAssistantTasks", () => {
  it("retires the conversation once its pull request is merged or closed", () => {
    const shadow = task({ id: "t2", origin: "pr-review", tags: [prTaskTag(pr())] });
    expect(closedPrAssistantTasks([shadow], [pr({ state: "closed" })])).toEqual([shadow]);
  });

  it("leaves an open pull request's conversation alone", () => {
    const shadow = task({ id: "t2", origin: "pr-review", tags: [prTaskTag(pr())] });
    expect(closedPrAssistantTasks([shadow], [pr()])).toEqual([]);
  });

  it("says nothing about a pull request the listing does not carry", () => {
    // The default listing filter is `open`, so a merged PR simply falls out of
    // it — absence is not evidence of a close, and the daemon's TTL sweep is
    // what retires those.
    const shadow = task({ id: "t2", origin: "pr-review", tags: [prTaskTag(pr())] });
    expect(closedPrAssistantTasks([shadow], [])).toEqual([]);
  });

  it("does not re-archive one that is already finished", () => {
    const shadow = task({
      id: "t2",
      origin: "pr-review",
      status: "done",
      tags: [prTaskTag(pr())],
    });
    expect(closedPrAssistantTasks([shadow], [pr({ state: "closed" })])).toEqual([]);
  });
});
