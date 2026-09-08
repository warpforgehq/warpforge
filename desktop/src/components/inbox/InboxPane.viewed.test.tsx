import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseUnifiedPatch } from "@/lib/pullDiff";
import { fingerprintPatchFile, pullViewedKey, resetPullViewedCache } from "@/lib/pullViewed";
import type { PullRequestDiff, PullRequestSummary } from "@/protocol";
import { useUi } from "@/store/ui";

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
};

const diff: PullRequestDiff = {
  additions: 2,
  deletions: 2,
  files: [
    { path: "src/a.ts", additions: 1, deletions: 1 },
    { path: "src/b.ts", additions: 1, deletions: 1 },
  ],
  patch: [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,2 +1,2 @@",
    " kept",
    "-old a",
    "+new a",
    "diff --git a/src/b.ts b/src/b.ts",
    "--- a/src/b.ts",
    "+++ b/src/b.ts",
    "@@ -1,2 +1,2 @@",
    " kept",
    "-old b",
    "+new b",
  ].join("\n"),
  truncated: false,
};

vi.mock("@/daemon", () => ({
  daemon: {
    listPulls: vi.fn<() => Promise<PullRequestSummary[]>>(async () => [pr]),
    pullDetails: vi.fn<() => Promise<null>>(async () => null),
    pullThread: vi.fn<() => Promise<{ comments: []; reviews: [] }>>(async () => ({
      comments: [],
      reviews: [],
    })),
    pullDiff: vi.fn<() => Promise<PullRequestDiff>>(async () => diff),
    createPullReviewComment: vi.fn<() => Promise<never>>(async () => {
      throw new Error("not used");
    }),
    postPullComment: vi.fn<() => Promise<string>>(async () => "x"),
  },
}));

vi.mock("@/lib/pullDiffHighlight", () => ({
  highlightPatchBlock: vi.fn<() => Promise<Map<string, never>>>(
    async () => new Map<string, never>(),
  ),
}));

import { InboxPane } from "./InboxPane";

function renderPane() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <InboxPane projects={["warpforge"]} />
    </QueryClientProvider>,
  );
}

describe("InboxPane: viewed end to end", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetPullViewedCache();
    useUi.setState({ diffView: "unified", pullFilesPanelCollapsed: false });
  });

  it("the user's path: open PR, Code tab, tick Viewed, file folds, counter moves", async () => {
    const user = userEvent.setup();
    renderPane();
    await screen.findByText("Add widget");
    await user.click(screen.getByRole("tab", { name: "Diff" }));
    await screen.findByText("0/2 viewed");
    expect(screen.getByText("new a")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Viewed" })[0]);

    expect(screen.getByText("1/2 viewed")).toBeInTheDocument();
    expect(screen.queryByText("new a")).not.toBeInTheDocument();
    expect(screen.getByText("new b")).toBeInTheDocument();
  });

  it("ticking from the rail folds the file and moves the counter", async () => {
    const user = userEvent.setup();
    renderPane();
    await screen.findByText("Add widget");
    await user.click(screen.getByRole("tab", { name: "Diff" }));
    await screen.findByText("0/2 viewed");

    const rail = screen.getAllByRole("checkbox", { name: "Mark src/a.ts as viewed" });
    await user.click(rail[0]);

    expect(screen.getByText("1/2 viewed")).toBeInTheDocument();
    expect(screen.queryByText("new a")).not.toBeInTheDocument();
    expect(fingerprintPatchFile(parseUnifiedPatch(diff.patch)[0])).toBeTruthy();
    expect(pullViewedKey(pr)).toBe("acme/widgets#7");
  });
});
