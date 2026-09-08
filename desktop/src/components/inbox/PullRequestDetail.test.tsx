import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PullRequestDetails, PullRequestSummary, PullThread } from "@/protocol";

const { pullDetails, pullThread, pullDiff, pullReview } = vi.hoisted(() => ({
  pullDetails: vi.fn<(project: string, number: number) => Promise<PullRequestDetails>>(),
  pullThread: vi.fn<(project: string, number: number) => Promise<PullThread>>(),
  pullDiff: vi.fn<(project: string, number: number) => Promise<never>>(),
  pullReview:
    vi.fn<
      (
        project: string,
        number: number,
        event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
        body?: string,
      ) => Promise<string>
    >(),
}));

vi.mock("@/daemon", () => ({ daemon: { pullDetails, pullDiff, pullThread, pullReview } }));

import { PullRequestDetail } from "./PullRequestDetail";

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
    updatedAt: 1_000,
    ...overrides,
  };
}

const details: PullRequestDetails = {
  title: "Add widget",
  url: "https://github.test/pull/7",
  state: "open",
  draft: false,
  body: "does the thing",
  baseRefName: "main",
  headRefName: "widget",
  additions: 3,
  deletions: 1,
  changedFiles: 2,
};

const thread: PullThread = {
  comments: [],
  truncated: false,
  reviewDecision: null,
  baseRefName: "main",
  headRefName: "widget",
};

function renderDetail(summary: PullRequestSummary) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <PullRequestDetail pr={summary} />
    </QueryClientProvider>,
  );
  const rerender = (next: PullRequestSummary) =>
    view.rerender(
      <QueryClientProvider client={client}>
        <PullRequestDetail pr={next} />
      </QueryClientProvider>,
    );
  return { rerender };
}

describe("PullRequestDetail refreshing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pullDetails.mockResolvedValue(details);
    pullThread.mockResolvedValue(thread);
  });

  it("refetches the conversation when the listing sees the PR move", async () => {
    const { rerender } = renderDetail(pr());
    await waitFor(() => expect(pullThread).toHaveBeenCalledTimes(1));

    // A new comment moves `updatedAt` on the next listing poll, and that is
    // the only signal the open review gets.
    rerender(pr({ updatedAt: 2_000 }));
    await waitFor(() => expect(pullThread).toHaveBeenCalledTimes(2));
    expect(pullDetails).toHaveBeenCalledTimes(2);
  });

  it("leaves the open review alone while the PR sits still", async () => {
    const { rerender } = renderDetail(pr());
    await waitFor(() => expect(pullThread).toHaveBeenCalledTimes(1));

    // Same timestamp: a poll that found nothing new must not refetch.
    rerender(pr({ title: "Add widget" }));
    await waitFor(() => expect(pullThread).toHaveBeenCalledTimes(1));
  });

  it("refetches on demand", async () => {
    const user = userEvent.setup();
    renderDetail(pr());
    await waitFor(() => expect(pullThread).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Refresh this pull request" }));
    await waitFor(() => expect(pullThread).toHaveBeenCalledTimes(2));
  });
});

describe("PullRequestDetail review verdicts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pullDetails.mockResolvedValue(details);
    pullThread.mockResolvedValue(thread);
    pullReview.mockResolvedValue("https://github.test/review/1");
  });

  it("approves through the composer and refreshes the decision", async () => {
    const user = userEvent.setup();
    renderDetail(pr());
    await waitFor(() => expect(pullThread).toHaveBeenCalledTimes(1));

    // Header button opens the composer; the composer's own Approve submits.
    await user.click(screen.getAllByRole("button", { name: "Approve" })[0]);
    await user.type(screen.getByRole("textbox", { name: "Approval summary" }), "looked good");
    await user.click([...screen.getAllByRole("button", { name: "Approve" })].pop() as HTMLElement);
    await waitFor(() =>
      expect(pullReview).toHaveBeenCalledWith("warpforge", 7, "APPROVE", "looked good"),
    );
  });

  it("requires a summary before changes can be requested", async () => {
    const user = userEvent.setup();
    renderDetail(pr());
    await waitFor(() => expect(pullThread).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Request changes" }));
    const submit = [
      ...screen.getAllByRole("button", { name: "Request changes" }),
    ].pop() as HTMLButtonElement;
    expect(submit).toBeDisabled();
    await user.type(
      screen.getByRole("textbox", { name: "Explain what needs to change" }),
      "tests are missing",
    );
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() =>
      expect(pullReview).toHaveBeenCalledWith(
        "warpforge",
        7,
        "REQUEST_CHANGES",
        "tests are missing",
      ),
    );
  });

  it("blocks verdicts on a draft pull request", async () => {
    renderDetail(pr({ draft: true }));
    await waitFor(() => expect(pullThread).toHaveBeenCalledTimes(1));
    for (const name of ["Approve", "Request changes"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(pullReview).not.toHaveBeenCalled();
  });
});
