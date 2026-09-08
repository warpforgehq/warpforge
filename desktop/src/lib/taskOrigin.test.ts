import { describe, expect, it } from "vitest";

import {
  boardTasks,
  closedPrAssistantTasks,
  findPrAssistantTask,
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
