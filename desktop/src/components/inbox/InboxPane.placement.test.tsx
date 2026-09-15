import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PullRequestSummary } from "@/protocol";
import { useUi } from "@/store/ui";

function pull(number: number, title: string): PullRequestSummary {
  return {
    assignees: [],
    baseRefName: "main",
    createdAt: 0,
    draft: false,
    headRefName: `branch-${number}`,
    labels: [],
    number,
    project: "warpforge",
    repo: "acme/widgets",
    state: "open",
    title,
    updatedAt: number,
    url: `https://github.test/pull/${number}`,
  };
}

const pulls = [pull(2, "Second widget"), pull(1, "First widget")];

vi.mock("@/daemon", () => ({
  daemon: {
    listPulls: vi.fn<() => Promise<PullRequestSummary[]>>(async () => pulls),
    pullDetails: vi.fn<() => Promise<null>>(async () => null),
    pullThread: vi.fn<() => Promise<{ comments: []; reviews: [] }>>(async () => ({
      comments: [],
      reviews: [],
    })),
    pullDiff: vi.fn<() => Promise<null>>(async () => null),
    pullCommits: vi.fn<() => Promise<[]>>(async () => []),
  },
}));

import { InboxPane } from "./InboxPane";

function renderPane(listPlacement: "pane" | "sidebar") {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <InboxPane projects={["warpforge"]} listPlacement={listPlacement} />
    </QueryClientProvider>,
  );
}

describe("InboxPane list placement", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useUi.setState({ inboxSelectedKey: null });
  });

  it("renders the review alone when the sidebar is carrying the list", async () => {
    renderPane("sidebar");

    // The review is here — the rows are not, because the sidebar has them.
    expect(await screen.findByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Filter pull requests")).not.toBeInTheDocument();
  });

  it("keeps its own list on a window too narrow for a sidebar", async () => {
    renderPane("pane");

    expect(await screen.findByTitle("First widget")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter pull requests")).toBeInTheDocument();
  });

  it("holds the selected pull request in the store, so leaving the inbox keeps it", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPane("pane");

    await user.click(await screen.findByTitle("First widget"));
    expect(useUi.getState().inboxSelectedKey).toBe("acme/widgets#1");

    // Switching away and back is an unmount: component state would be gone.
    unmount();
    renderPane("pane");
    expect(await screen.findByRole("heading", { name: /First widget/ })).toBeInTheDocument();
  });
});
