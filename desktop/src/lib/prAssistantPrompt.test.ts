import { describe, expect, it } from "vitest";

import { INLINE_PATCH_MAX_BYTES, prAssistantPrompt } from "@/lib/prAssistantPrompt";
import type { PullRequestDiff, PullRequestSummary } from "@/protocol";

function section(path: string, lines: number): string {
  const hunk = Array.from({ length: lines }, (_, index) => `+line ${index}`).join("\n");
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines} @@`,
    hunk,
    "",
  ].join("\n");
}

const pr: PullRequestSummary = {
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
  additions: 4000,
  deletions: 12,
  changedFiles: 2,
};

const bigDiff: PullRequestDiff = {
  additions: 4000,
  deletions: 12,
  files: [
    { path: "src/a.ts", additions: 3000, deletions: 6 },
    { path: "docs/notes.md", additions: 1000, deletions: 6 },
  ],
  patch: `${section("src/a.ts", 40_000)}${section("docs/notes.md", 40)}`,
  truncated: false,
};

const smallDiff: PullRequestDiff = {
  additions: 2,
  deletions: 1,
  files: [{ path: "src/a.ts", additions: 2, deletions: 1 }],
  patch: section("src/a.ts", 20),
  truncated: false,
};

describe("prAssistantPrompt", () => {
  it("sends a big change as a file list and one way to read it", () => {
    const prompt = prAssistantPrompt({ intent: "explain", pr, diff: bigDiff });

    expect(bigDiff.patch.length).toBeGreaterThan(INLINE_PATCH_MAX_BYTES);
    expect(prompt).not.toContain("```diff");
    expect(prompt.length).toBeLessThan(4_000);
    // Named files with their sizes, so the agent picks what to open.
    expect(prompt).toContain("- src/a.ts  +3000 −6");
    expect(prompt).toContain("git fetch origin main widget");
    expect(prompt).toContain("git diff origin/main...origin/widget");
    expect(prompt).toContain("gh pr diff 7");
    // The double read this replaced: patch inlined *and* "go read the files".
    expect(prompt).toContain("do not re-read what");
    expect(prompt).toContain("never switch or check out a branch here");
  });

  it("inlines a small change so there is nothing to fetch", () => {
    const prompt = prAssistantPrompt({ intent: "explain", pr, diff: smallDiff });

    expect(prompt).toContain("```diff");
    expect(prompt).toContain("so you do not need to fetch it");
    expect(prompt).not.toContain("git fetch origin");
  });

  it("names the pull request and its size either way", () => {
    for (const diff of [bigDiff, smallDiff]) {
      for (const intent of ["explain", "review"] as const) {
        const prompt = prAssistantPrompt({ diff, intent, pr });
        expect(prompt).toContain("acme/widgets#7");
        expect(prompt).toContain("+4000 −12 across 2 files");
      }
    }
  });

  it("differs only in the task it opens with", () => {
    const explain = prAssistantPrompt({ intent: "explain", pr, diff: bigDiff });
    const review = prAssistantPrompt({ intent: "review", pr, diff: bigDiff });
    expect(explain).toContain("Where to look first");
    expect(explain).toContain("at most 8 nodes");
    // Review asks for findings and nothing decorative: the first version
    // leaked the explain forms into it and produced a four-section essay.
    expect(review).toContain("Findings only");
    expect(review).toContain("no diagram, no pseudocode");
    expect(review).not.toContain("mermaid");
  });

  it("carries the description when there is one", () => {
    const prompt = prAssistantPrompt({
      intent: "explain",
      pr,
      details: {
        title: pr.title,
        url: pr.url,
        state: "open",
        draft: false,
        body: "Adds the widget.",
        baseRefName: "main",
        headRefName: "widget",
        additions: 4000,
        deletions: 12,
        changedFiles: 2,
      },
      diff: bigDiff,
    });
    expect(prompt).toContain("> Adds the widget.");
  });

  it("still works before the diff has been fetched", () => {
    const prompt = prAssistantPrompt({ intent: "review", pr });
    expect(prompt).toContain("acme/widgets#7");
    expect(prompt).toContain("git diff origin/main...origin/widget");
    expect(prompt).not.toContain("```diff");
  });

  it("says to trust git when GitHub truncated its own patch", () => {
    const prompt = prAssistantPrompt({
      intent: "review",
      pr,
      diff: { ...bigDiff, truncated: true },
    });
    expect(prompt).toContain("GitHub truncated its own patch");
  });
});
