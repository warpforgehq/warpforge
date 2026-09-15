import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PullRequestFile } from "@/protocol";

import { PullDiffSkeleton } from "./PullDiffSkeleton";

const files: PullRequestFile[] = [
  { path: "src/a.ts", additions: 1, deletions: 1 },
  { path: "src/b.ts", additions: 40, deletions: 2 },
];

describe("PullDiffSkeleton", () => {
  it("reserves three diff-file blocks, announced, and never a sentence", () => {
    const { container } = render(<PullDiffSkeleton mode="unified" />);
    const skeleton = screen.getByTestId("pull-diff-skeleton");

    expect(skeleton).toHaveAttribute("role", "status");
    expect(skeleton).toHaveAttribute("aria-label", "Loading changes");
    expect(screen.getAllByTestId("file-skeleton")).toHaveLength(3);
    expect(screen.queryByText(/Loading changes/)).not.toBeInTheDocument();
    // One pulse per file block, not one per bar.
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);
  });

  it("reserves the six-line floor when the file list is not known yet", () => {
    render(<PullDiffSkeleton mode="unified" />);
    // 36px header + six 20px rows.
    expect(screen.getAllByTestId("file-skeleton")[0].style.height).toBe("156px");
  });

  it("sizes a known file from its changed-line count, capped at the row cap", () => {
    render(<PullDiffSkeleton files={files} mode="unified" />);
    const blocks = screen.getAllByTestId("file-skeleton");
    // A one-line file stays on the six-line floor.
    expect(blocks[0].style.height).toBe("156px");
    // A forty-two-line file is capped at twenty-four rows.
    expect(blocks[1].style.height).toBe("516px");
  });

  it("fills each block it reserved, so no gap opens between two files", () => {
    render(<PullDiffSkeleton files={files} mode="unified" />);
    const blocks = screen.getAllByTestId("file-skeleton");

    expect(blocks[0].querySelectorAll('[data-testid="file-skeleton-row"]')).toHaveLength(6);
    expect(blocks[1].querySelectorAll('[data-testid="file-skeleton-row"]')).toHaveLength(24);
    expect(screen.queryAllByTestId("file-skeleton-tail")).toHaveLength(0);
  });

  it("is identical on every render, so screenshots and tests are stable", () => {
    const { container, rerender } = render(<PullDiffSkeleton files={files} mode="split" />);
    const first = container.innerHTML;

    rerender(<PullDiffSkeleton files={files} mode="split" />);
    expect(container.innerHTML).toBe(first);
  });
});
