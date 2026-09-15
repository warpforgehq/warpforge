import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PushPreviewSkeleton } from "./PushPreviewSkeleton";

describe("PushPreviewSkeleton", () => {
  it("is a busy, announced preview and never a loading sentence", () => {
    const { container } = render(<PushPreviewSkeleton />);
    const block = screen.getByTestId("push-preview-skeleton");

    expect(block).toHaveAttribute("aria-busy", "true");
    expect(block).toHaveAttribute("role", "status");
    expect(block).toHaveAttribute("aria-label", "Reading outgoing commits");
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
    expect(block.className).toContain("motion-reduce:animate-none");
  });

  it("fills the spinner's min-h-40 slot with CommitRow's own two-line shape", () => {
    render(<PushPreviewSkeleton />);
    const block = screen.getByTestId("push-preview-skeleton");
    const rows = screen.getAllByTestId("push-preview-skeleton-row");

    expect(block.className).toContain("min-h-40");
    // The scroller around this already pads; a second p-2 double-indented it.
    expect(block.className).not.toContain("p-2");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.className).toContain("px-3");
      expect(row.className).toContain("py-2");
      // Subject line and meta line, as the real row carries.
      expect(row.lastElementChild!.children).toHaveLength(2);
    }
  });

  it("is identical on every render, so screenshots and tests are stable", () => {
    const { container, rerender } = render(<PushPreviewSkeleton />);
    const first = container.innerHTML;

    rerender(<PushPreviewSkeleton />);
    expect(container.innerHTML).toBe(first);
  });
});
