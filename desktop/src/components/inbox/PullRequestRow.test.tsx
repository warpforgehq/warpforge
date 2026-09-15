import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PullRequestSummary } from "@/protocol";

import { PullRequestRow } from "./PullRequestRow";
import { ReviewDecisionChip } from "./ReviewDecisionChip";

function pr(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    project: "warpforge",
    repo: "acme/widgets",
    number: 7,
    title: "Add widget",
    url: "https://github.com/acme/widgets/pull/7",
    state: "open",
    draft: false,
    labels: [{ name: "bug", color: "ff0000" }],
    additions: 312,
    deletions: 89,
    changedFiles: 4,
    assignees: [],
    baseRefName: "main",
    headRefName: "widget",
    createdAt: 0,
    updatedAt: Math.floor(Date.now() / 1000) - 120,
    ...overrides,
  };
}

describe("PullRequestRow", () => {
  it("opens the pull request when clicked", async () => {
    const onOpen = vi.fn<(pr: PullRequestSummary) => void>();
    render(<PullRequestRow pr={pr()} unseen={false} active={false} actions={{ onOpen }} />);
    const user = (await import("@testing-library/user-event")).default.setup();
    await user.click(screen.getByRole("button", { name: /Add widget/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ number: 7 }));
  });

  it("shows how big the review is", () => {
    render(
      <PullRequestRow pr={pr()} unseen={false} active={false} actions={{ onOpen: () => {} }} />,
    );
    expect(screen.getByText("+312")).toBeInTheDocument();
    expect(screen.getByText("−89")).toBeInTheDocument();
  });

  it("leaves the counts off a pull request whose size is unknown", () => {
    render(
      <PullRequestRow
        pr={pr({ additions: 0, deletions: 0 })}
        unseen={false}
        active={false}
        actions={{ onOpen: () => {} }}
      />,
    );
    expect(screen.queryByText("+0")).not.toBeInTheDocument();
  });

  it("reads the review decision off a glyph, not a full-width chip", () => {
    render(
      <PullRequestRow
        pr={pr({ reviewDecision: "APPROVED" })}
        unseen={false}
        active={false}
        actions={{ onOpen: () => {} }}
      />,
    );
    expect(screen.getByLabelText("Approved")).toBeInTheDocument();
    // The words would eat two thirds of a 320px row.
    expect(screen.queryByText("Approved")).not.toBeInTheDocument();
  });

  it("says a PR is a draft with its glyph rather than a word", () => {
    render(
      <PullRequestRow
        pr={pr({ draft: true })}
        unseen={false}
        active={false}
        actions={{ onOpen: () => {} }}
      />,
    );
    expect(screen.getByLabelText("Draft")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });

  it("keeps the row to meta over title, leaving labels to the review's meta rail", () => {
    const { container } = render(
      <PullRequestRow
        pr={pr({
          labels: ["a", "b", "c", "d", "e"].map((name) => ({ name, color: "ff0000" })),
        })}
        unseen={false}
        active={false}
        actions={{ onOpen: () => {} }}
      />,
    );

    expect(screen.getByTitle("acme/widgets#7")).toBeInTheDocument();
    expect(screen.queryByText("bug")).not.toBeInTheDocument();
    // Two lines, fixed height: a conditional third line is what made the list
    // rag against the task rows beside it.
    expect(container.querySelector("button")!.children).toHaveLength(2);
  });

  it("marks an unseen PR in a lane that is reserved on every row", () => {
    const { container, rerender } = render(
      <PullRequestRow pr={pr()} unseen={true} active={false} actions={{ onOpen: () => {} }} />,
    );
    const lane = () => container.querySelector("button")!.lastElementChild!.firstElementChild!;

    expect(lane().querySelector("[data-unread]")).not.toBeNull();
    const width = lane().className;

    rerender(
      <PullRequestRow pr={pr()} unseen={false} active={false} actions={{ onOpen: () => {} }} />,
    );
    // Same lane, no dot — so a read title starts where an unread one does.
    expect(lane().querySelector("[data-unread]")).toBeNull();
    expect(lane().className).toBe(width);
  });

  it("wears the sidebar's row language rather than a full-bleed band", () => {
    const { container, rerender } = render(
      <PullRequestRow pr={pr()} unseen={false} active={false} actions={{ onOpen: () => {} }} />,
    );
    const row = () => container.querySelector("button")!;

    expect(row().className).toContain("rounded-md");
    expect(row().className).toContain("px-2");
    expect(row().className).toContain("hover:bg-accent/60");
    expect(row().className).not.toContain("border-b");

    rerender(
      <PullRequestRow pr={pr()} unseen={false} active={true} actions={{ onOpen: () => {} }} />,
    );
    expect(row().className).toContain("bg-accent");
  });
});

describe("ReviewDecisionChip", () => {
  it("names the three GitHub decisions and renders nothing without one", () => {
    const { rerender } = render(<ReviewDecisionChip decision="APPROVED" />);
    expect(screen.getByText("Approved")).toBeInTheDocument();
    rerender(<ReviewDecisionChip decision="CHANGES_REQUESTED" />);
    expect(screen.getByText("Changes requested")).toBeInTheDocument();
    rerender(<ReviewDecisionChip decision="REVIEW_REQUIRED" />);
    expect(screen.getByText("Review required")).toBeInTheDocument();
    rerender(<ReviewDecisionChip decision={null} />);
    expect(document.querySelector("span")).toBeNull();
  });
});
