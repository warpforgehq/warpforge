import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EditorSkeleton } from "./EditorSkeleton";

describe("EditorSkeleton", () => {
  it("is a busy block that never renders loading text", () => {
    render(<EditorSkeleton />);

    const block = screen.getByTestId("editor-skeleton");
    expect(block).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
  });

  it("owns exactly one pulse, however many rows it draws", () => {
    const { container } = render(<EditorSkeleton />);

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
    expect(
      container.querySelectorAll('[data-testid="editor-skeleton"] > div').length,
    ).toBeGreaterThan(1);
  });

  it("is identical on every render, so screenshots and tests are stable", () => {
    const { container, rerender } = render(<EditorSkeleton />);
    const first = container.querySelector('[data-testid="editor-skeleton"]')!.innerHTML;

    rerender(<EditorSkeleton />);
    const second = container.querySelector('[data-testid="editor-skeleton"]')!.innerHTML;

    expect(second).toBe(first);
  });

  it("fills the slot: an explicit height reserves the virtualizer's estimate", () => {
    render(<EditorSkeleton height={384} />);

    const block = screen.getByTestId("editor-skeleton");
    expect(block.parentElement?.style.height).toBe("384px");
    expect(block).toHaveClass("h-full");
  });

  it("fills its container when no estimate is known yet", () => {
    render(<EditorSkeleton />);

    expect(screen.getByTestId("editor-skeleton")).toHaveClass("h-full");
  });

  it("caps the row count at maxLines for preview call sites", () => {
    const { container } = render(<EditorSkeleton maxLines={8} />);

    const rows = container.querySelectorAll('[data-testid="editor-skeleton"] > div');
    expect(rows.length).toBeLessThanOrEqual(8);
  });
});
