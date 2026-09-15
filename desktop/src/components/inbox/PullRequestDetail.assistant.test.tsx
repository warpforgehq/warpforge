import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isInboxEntryUnseen, prAssistantSeenKey } from "@/lib/inboxSeen";
import type { PullRequestDetails, PullRequestSummary, PullThread } from "@/protocol";

const { pullDetails, pullThread } = vi.hoisted(() => ({
  pullDetails: vi.fn<(project: string, number: number) => Promise<PullRequestDetails>>(),
  pullThread: vi.fn<(project: string, number: number) => Promise<PullThread>>(),
}));

const { daemonState } = vi.hoisted(() => ({
  daemonState: { snapshot: { agents: [] as unknown[], tasks: [] as unknown[] } },
}));

vi.mock("@/daemon", () => ({
  daemon: {
    getState: () => daemonState,
    pullDetails,
    pullDiff: vi.fn<() => Promise<never>>(),
    pullReview: vi.fn<() => Promise<string>>(),
    pullThread,
    subscribe: () => () => {},
  },
}));

vi.mock("@/components/inbox/PullAssistant", () => ({
  PullAssistantLive: () => <div data-testid="assistant-thread" />,
}));

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

const assistantTask = {
  agent: "claude",
  blockedReason: null,
  createdAt: 1,
  filesChanged: 0,
  id: "assistant-1",
  origin: "pr-review",
  project: "warpforge",
  prompt: "review this",
  status: "waiting",
  tags: ["pr-review", "pr:acme/widgets#7"],
  title: "Review the pull request",
  updatedAt: 50,
};

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PullRequestDetail pr={pr()} />
    </QueryClientProvider>,
  );
}

describe("PullRequestDetail assistant tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    daemonState.snapshot.tasks = [];
    pullDetails.mockResolvedValue(details);
    pullThread.mockResolvedValue(thread);
  });

  it("shows the working glyph on the Assistant tab while the review runs", async () => {
    daemonState.snapshot.tasks = [{ ...assistantTask, status: "running" }];

    renderDetail();

    expect(await screen.findByLabelText("Assistant review in progress")).toBeInTheDocument();
    expect(screen.queryByLabelText("Assistant review ready")).not.toBeInTheDocument();
  });

  it("shows an unseen dot and clears it when the tab is opened", async () => {
    daemonState.snapshot.tasks = [assistantTask];
    const user = userEvent.setup();
    renderDetail();

    expect(await screen.findByLabelText("Assistant review ready")).toBeInTheDocument();
    const entry = { key: prAssistantSeenKey(pr()), updatedAt: assistantTask.updatedAt };
    expect(isInboxEntryUnseen(entry)).toBe(true);

    await user.click(screen.getByRole("tab", { name: /Assistant/ }));

    await waitFor(() => expect(screen.queryByLabelText("Assistant review ready")).toBeNull());
    // Opening the tab is the mark: one seen store, the inbox's own.
    expect(isInboxEntryUnseen(entry)).toBe(false);
  });

  it("draws no indicator when the pull request has no assistant task", async () => {
    renderDetail();
    await waitFor(() => expect(pullThread).toHaveBeenCalled());

    expect(screen.queryByLabelText("Assistant review ready")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Assistant review in progress")).not.toBeInTheDocument();
  });
});
