import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PullFilesChangedSkeleton } from "./PullFilesChangedSkeleton";

describe("PullFilesChangedSkeleton", () => {
  it("draws two group blocks of four rows, busy, and never a sentence", () => {
    const { container } = render(<PullFilesChangedSkeleton />);
    const block = screen.getByTestId("pull-files-changed-skeleton");

    expect(block).toHaveAttribute("aria-busy", "true");
    expect(block).toHaveAttribute("role", "status");
    expect(block).toHaveAttribute("aria-label", "Loading files");
    expect(screen.getAllByTestId("pull-files-changed-group")).toHaveLength(2);
    expect(screen.getAllByTestId("pull-files-changed-row")).toHaveLength(8);
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
    expect(block.className).toContain("motion-reduce:animate-none");
  });

  it("mirrors FileGroup's 28px header and 24px rows under a left rule", () => {
    render(<PullFilesChangedSkeleton />);
    const group = screen.getAllByTestId("pull-files-changed-group")[0];
    const header = group.firstElementChild!;
    const rows = group.lastElementChild!;

    expect(header.className).toContain("h-7");
    expect(rows.className).toContain("border-l");
    expect(rows.className).toContain("pl-1.5");

    const row = screen.getAllByTestId("pull-files-changed-row")[0];
    expect(row.className).toContain("h-6");
    expect(row.className).toContain("rounded");
    expect(row.className).toContain("px-1.5");
  });

  it("is identical on every render, so screenshots and tests are stable", () => {
    const { container, rerender } = render(<PullFilesChangedSkeleton />);
    const first = container.innerHTML;

    rerender(<PullFilesChangedSkeleton />);
    expect(container.innerHTML).toBe(first);
  });
});
