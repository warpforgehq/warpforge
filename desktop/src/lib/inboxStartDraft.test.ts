import { describe, expect, it } from "vitest";

import type { PullRequestDetails, PullRequestSummary } from "@/protocol";

import { inboxStartPrompt } from "./inboxStartDraft";

const summary: PullRequestSummary = {
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
  createdAt: 0,
  updatedAt: 0,
};

describe("inboxStartPrompt", () => {
  it("names the PR, links it, and shows the branch direction", () => {
    const prompt = inboxStartPrompt(summary);
    expect(prompt).toContain("pull request");
    expect(prompt).toContain("acme/widgets#7 Add widget");
    expect(prompt).toContain("https://github.com/acme/widgets/pull/7");
    expect(prompt).toContain("widget → main");
  });

  it("carries the body when the details have arrived, and nothing when not", () => {
    const details: PullRequestDetails = {
      ...summary,
      state: "open",
      draft: false,
      body: "Please fix the widget sizing.",
      additions: 0,
      deletions: 0,
      changedFiles: 0,
    };
    expect(inboxStartPrompt(summary, details)).toContain("Please fix the widget sizing.");
    expect(inboxStartPrompt(summary, null)).not.toContain("Please fix");
  });
});
