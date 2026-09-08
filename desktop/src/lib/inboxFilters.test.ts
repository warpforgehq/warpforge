import { describe, expect, it } from "vitest";

import type { PullRequestSummary } from "@/protocol";

import {
  applyInboxFilters,
  DEFAULT_INBOX_FILTERS,
  hasActiveInboxFilters,
  inboxFetchState,
  matchesPullQuery,
  sortInboxItems,
} from "./inboxFilters";

function pr(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    project: "warpforge",
    repo: "acme/widgets",
    number: 7,
    title: "Add widget",
    url: "https://github.com/acme/widgets/pull/7",
    state: "open",
    draft: false,
    labels: [],
    assignees: [],
    baseRefName: "main",
    headRefName: "widget",
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

describe("applyInboxFilters", () => {
  it("drops closed PRs while the state filter reads open", () => {
    const items = [pr({ state: "open" }), pr({ number: 8, state: "closed" })];
    expect(applyInboxFilters(items, DEFAULT_INBOX_FILTERS)).toHaveLength(1);
  });

  it("keeps everything under the all state", () => {
    const items = [pr(), pr({ number: 8, state: "closed" })];
    expect(applyInboxFilters(items, { ...DEFAULT_INBOX_FILTERS, state: "all" })).toHaveLength(2);
  });

  it("assignedToMe means assigned to somebody, not to a name we do not know", () => {
    // The daemon has already filtered by the viewer; client-side this is the
    // honest approximation available — a PR with no assignees cannot be "mine".
    const items = [pr({ assignees: ["me"] }), pr({ number: 8, assignees: [] })];
    expect(applyInboxFilters(items, { ...DEFAULT_INBOX_FILTERS, assignedToMe: true })).toHaveLength(
      1,
    );
  });

  it("search matches title, repo, number, author and labels", () => {
    const item = pr({
      number: 42,
      title: "Fix the flange",
      labels: [{ name: "bug", color: null }],
      author: { login: "octocat", avatarUrl: null },
    });
    for (const query of ["flange", "acme", "#42", "42", "octocat", "bug"]) {
      expect(`${query}: ${matchesPullQuery(item, query)}`).toBe(`${query}: true`);
    }
    expect(matchesPullQuery(item, "nomatch")).toBe(false);
  });
});

describe("sortInboxItems", () => {
  it("orders by newest update, then repo, then number", () => {
    const sorted = sortInboxItems([
      pr({ number: 1, repo: "b/r", updatedAt: 100 }),
      pr({ number: 3, repo: "a/r", updatedAt: 100 }),
      pr({ number: 9, repo: "a/r", updatedAt: 200 }),
    ]);
    expect(sorted.map((item) => `${item.repo}#${item.number}`)).toEqual([
      "a/r#9",
      "a/r#3",
      "b/r#1",
    ]);
  });
});

describe("filter bookkeeping", () => {
  it("knows when the user narrowed the listing", () => {
    expect(hasActiveInboxFilters(DEFAULT_INBOX_FILTERS)).toBe(false);
    expect(hasActiveInboxFilters({ ...DEFAULT_INBOX_FILTERS, search: "x" })).toBe(true);
    expect(hasActiveInboxFilters({ ...DEFAULT_INBOX_FILTERS, state: "all" })).toBe(true);
    expect(hasActiveInboxFilters({ ...DEFAULT_INBOX_FILTERS, assignedToMe: true })).toBe(true);
  });

  it("feeds the daemon fetch its state verbatim", () => {
    expect(inboxFetchState(DEFAULT_INBOX_FILTERS)).toBe("open");
    expect(inboxFetchState({ ...DEFAULT_INBOX_FILTERS, state: "all" })).toBe("all");
  });
});
