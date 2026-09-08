import { describe, expect, it } from "vitest";

import { inboxTaskPrompt, unresolvedReviewComments } from "@/lib/inboxTaskPrompt";
import type { PullComment, PullRequestSummary, PullThread } from "@/protocol";

const pr: PullRequestSummary = {
  project: "kodjin-analytics",
  repo: "edenlabllc/kodjin-analytics",
  number: 458,
  title: "Feat/test query write",
  url: "https://github.com/edenlabllc/kodjin-analytics/pull/458",
  state: "open",
  draft: false,
  labels: [],
  assignees: [],
  baseRefName: "main",
  headRefName: "feat/test-query-write",
  createdAt: 0,
  updatedAt: 0,
  additions: 120,
  deletions: 4,
  changedFiles: 3,
};

function comment(overrides: Partial<PullComment>): PullComment {
  return {
    id: "c1",
    kind: "review_comment",
    author: { login: "mimir-code-assist[bot]" },
    body: "This query is unbounded — add a limit.",
    createdAt: new Date(0).toISOString(),
    url: "",
    state: "",
    path: "src/query.ts",
    line: 42,
    threadId: "t1",
    resolved: false,
    replies: [],
    ...overrides,
  };
}

function thread(comments: PullComment[]): PullThread {
  return {
    comments,
    truncated: false,
    reviewDecision: null,
    baseRefName: "main",
    headRefName: "feat/test-query-write",
  };
}

describe("unresolvedReviewComments", () => {
  it("keeps what somebody still has to act on", () => {
    const open = comment({});
    const resolved = comment({ id: "c2", resolved: true });
    const changes = comment({
      id: "c3",
      kind: "review",
      state: "CHANGES_REQUESTED",
      body: "Needs tests.",
      path: undefined,
      line: undefined,
    });
    const approval = comment({ id: "c4", kind: "review", state: "APPROVED", body: "lgtm" });
    const chat = comment({ id: "c5", kind: "comment", body: "thanks!" });

    expect(unresolvedReviewComments(thread([open, resolved, changes, approval, chat]))).toEqual([
      open,
      changes,
    ]);
  });

  it("ignores an inline comment with nothing in it", () => {
    expect(unresolvedReviewComments(thread([comment({ body: "  " })]))).toEqual([]);
  });
});

describe("inboxTaskPrompt", () => {
  it("tells the agent to work on the pull request's own branch", () => {
    for (const intent of ["comments", "branch"] as const) {
      const prompt = inboxTaskPrompt({ intent, pr, thread: thread([comment({})]) });
      expect(prompt).toContain("git fetch origin feat/test-query-write");
      expect(prompt).toContain("git switch feat/test-query-write");
      expect(prompt).toContain("edenlabllc/kodjin-analytics#458 Feat/test query write");
    }
  });

  it("carries the review comments the agent cannot see from a checkout", () => {
    const prompt = inboxTaskPrompt({
      intent: "comments",
      pr,
      thread: thread([
        comment({}),
        comment({
          id: "c3",
          kind: "review",
          state: "CHANGES_REQUESTED",
          body: "Needs tests.",
          path: undefined,
          line: undefined,
        }),
      ]),
    });
    expect(prompt).toContain("2 unresolved comments");
    expect(prompt).toContain("mimir-code-assist[bot] — src/query.ts:42");
    expect(prompt).toContain("This query is unbounded");
    expect(prompt).toContain("review, changes requested");
    // The old prompt said nothing about what to do with them.
    expect(prompt).toContain("commit and push");
  });

  it("says so rather than sending an agent to fix nothing", () => {
    const prompt = inboxTaskPrompt({ intent: "comments", pr, thread: thread([]) });
    expect(prompt).toContain("no unresolved review comments");
  });

  it("hands the description over when the job is to keep building", () => {
    const prompt = inboxTaskPrompt({
      intent: "branch",
      pr,
      details: {
        title: pr.title,
        url: pr.url,
        state: "open",
        draft: false,
        body: "Adds a write path for test queries.",
        baseRefName: "main",
        headRefName: "feat/test-query-write",
        additions: 120,
        deletions: 4,
        changedFiles: 3,
      },
      files: [
        { path: "src/query.ts", additions: 100, deletions: 2 },
        { path: "docs/queries.md", additions: 20, deletions: 2 },
      ],
    });
    expect(prompt).toContain("> Adds a write path for test queries.");
    expect(prompt).toContain("Size: +120 −4 across 3 files");
    expect(prompt).toContain("- src/query.ts");
    expect(prompt).toContain("Documentation (1)");
    // No review-comment section on this intent.
    expect(prompt).not.toContain("unresolved");
  });

  it("truncates a novel of a comment instead of shipping it whole", () => {
    const prompt = inboxTaskPrompt({
      intent: "comments",
      pr,
      thread: thread([comment({ body: "x".repeat(5_000) })]),
    });
    expect(prompt).toContain("truncated — read the rest on GitHub");
    expect(prompt.length).toBeLessThan(3_000);
  });
});
