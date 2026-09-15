import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FileListSkeleton } from "./FileListSkeleton";

describe("FileListSkeleton", () => {
  it("is a busy, announced list of file rows and never a loading sentence", () => {
    const { container } = render(<FileListSkeleton rows={4} label="Loading shelf" />);
    const block = screen.getByTestId("file-list-skeleton");

    expect(block).toHaveAttribute("aria-busy", "true");
    expect(block).toHaveAttribute("role", "status");
    expect(block).toHaveAttribute("aria-label", "Loading shelf");
    expect(screen.getAllByTestId("file-list-skeleton-row")).toHaveLength(4);
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
    expect(block.className).toContain("motion-reduce:animate-none");
  });

  it("uses the changes rail's 28px file-row height", () => {
    render(<FileListSkeleton rows={6} />);
    const rows = screen.getAllByTestId("file-list-skeleton-row");
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect((row as HTMLElement).style.height).toBe("28px");
    }
  });

  it("drops the count lane for the ignored tree, which has none", () => {
    render(<FileListSkeleton meta={false} />);
    const row = screen.getAllByTestId("file-list-skeleton-row")[0];
    expect(row.children).toHaveLength(2);
  });

  it("is identical on every render, so screenshots and tests are stable", () => {
    const { container, rerender } = render(<FileListSkeleton />);
    const first = container.innerHTML;

    rerender(<FileListSkeleton />);
    expect(container.innerHTML).toBe(first);
  });
});
