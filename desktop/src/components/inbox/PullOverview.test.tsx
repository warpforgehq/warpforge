import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PullComment, PullRequestDetails, PullRequestSummary, PullThread } from "@/protocol";

vi.mock("@/daemon", () => ({
  daemon: { postPullComment: vi.fn<() => Promise<string>>(async () => "https://github.test/c/1") },
}));

import { PullOverview } from "./PullOverview";

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
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000,
};

const details: PullRequestDetails = {
  title: "Add widget",
  url: "https://github.test/pull/7",
  state: "open",
  draft: false,
  body: "does the thing",
  baseRefName: "main",
  headRefName: "widget",
  additions: 41,
  deletions: 1,
  changedFiles: 3,
};

function comment(overrides: Partial<PullComment>): PullComment {
  return {
    id: "c1",
    kind: "review",
    author: { login: "gemini-code-assist" },
    body: "",
    createdAt: new Date(1_700_000_100_000).toISOString(),
    url: "",
    state: "",
    replies: [],
    ...overrides,
  };
}

function renderOverview(
  thread: PullThread | null,
  overrides: Partial<React.ComponentProps<typeof PullOverview>> = {},
) {
  return render(
    <PullOverview
      pr={pr}
      details={details}
      detailsLoading={false}
      thread={thread}
      threadLoading={false}
      reviewers={[{ login: "gemini-code-assist", state: "APPROVED" }]}
      files={[
        { path: "src/a.ts", additions: 30, deletions: 1 },
        { path: "src/b.ts", additions: 10, deletions: 0 },
        { path: "docs/notes.md", additions: 1, deletions: 0 },
      ]}
      onThreadChanged={() => {}}
      {...overrides}
    />,
  );
}

const emptyThread: PullThread = {
  comments: [],
  truncated: false,
  reviewDecision: null,
  baseRefName: "main",
  headRefName: "widget",
};

describe("PullOverview", () => {
  it("reads the description and the facts beside it", () => {
    renderOverview(emptyThread);
    expect(screen.getByText("does the thing")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("gemini-code-assist")).toBeInTheDocument();
    // No check run travels on the wire yet, and the rail says so rather than
    // implying everything passed.
    expect(screen.getByText("Status checks aren't read yet.")).toBeInTheDocument();
  });

  it("groups the changed files by code and prose, with each group's total", async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn<(path: string) => void>();
    renderOverview(emptyThread, { onOpenFile });

    expect(screen.getByText("3 files changed")).toBeInTheDocument();
    expect(screen.getByText("Implementation")).toBeInTheDocument();
    expect(screen.getByText("+40")).toBeInTheDocument();
    // Documentation arrives folded, with its own total on the heading.
    expect(screen.getByText("Documentation")).toBeInTheDocument();
    expect(screen.queryByText("notes.md")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Documentation/ }));
    await user.click(screen.getByText("notes.md"));
    expect(onOpenFile).toHaveBeenCalledWith("docs/notes.md");
  });

  it("renders a review as a card with its verdict and its code comments", async () => {
    const user = userEvent.setup();
    const onOpenDiff = vi.fn<() => void>();
    renderOverview(
      {
        ...emptyThread,
        comments: [
          comment({ body: "## Code Review\n\nlooks fine", state: "COMMENTED" }),
          comment({
            id: "c2",
            kind: "review_comment",
            path: "src/a.ts",
            line: 12,
            threadId: "t1",
            body: "rename this",
          }),
        ],
      },
      { onOpenDiff },
    );

    expect(screen.getByText("looks fine")).toBeInTheDocument();
    expect(screen.getByText("Reviewed")).toBeInTheDocument();
    // The inline comment itself belongs to the diff, not here.
    expect(screen.queryByText("rename this")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "1 code comment" }));
    expect(onOpenDiff).toHaveBeenCalled();
  });

  it("keeps an outdated thread readable, since no diff row can carry it", () => {
    renderOverview({
      ...emptyThread,
      comments: [
        comment({
          id: "c3",
          kind: "review_comment",
          path: "src/a.ts",
          line: null,
          originalLine: 4,
          diffHunk: "@@ -1,4 +1,4 @@\n kept\n-old\n+new\n context",
          threadId: "t2",
          body: "this moved",
        }),
      ],
    });
    expect(screen.getByText("this moved")).toBeInTheDocument();
    expect(screen.getByText("Outdated")).toBeInTheDocument();
  });

  it("lists every file rather than hiding the tail behind a second click", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      additions: 1,
      deletions: 0,
    }));
    renderOverview(emptyThread, { files: many });

    // One click opened the group; a second one to reveal "45 more files" was
    // the bug. The list scrolls instead.
    expect(screen.getByText("file-29.ts")).toBeInTheDocument();
    expect(screen.queryByText(/more files/)).not.toBeInTheDocument();
  });

  it("shows the count before the list, then the list, with nothing to click", () => {
    // No "Show file list" gate: the count comes from the listing, the list
    // follows on its own, and the rail never asked for a second click.
    renderOverview(emptyThread, { files: null });
    expect(screen.getByText("3 files changed")).toBeInTheDocument();
    expect(screen.getByText("Loading files…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show file list/ })).not.toBeInTheDocument();
  });
});
