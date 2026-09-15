import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MenuRowsSkeleton } from "./MenuRowsSkeleton";

describe("MenuRowsSkeleton", () => {
  it("is a busy, announced list of rows and never a loading sentence", () => {
    const { container } = render(<MenuRowsSkeleton rows={5} />);
    const block = screen.getByTestId("menu-rows-skeleton");

    expect(block).toHaveAttribute("aria-busy", "true");
    expect(block).toHaveAttribute("role", "status");
    expect(block).toHaveAttribute("aria-label", "Loading files");
    expect(screen.getAllByTestId("menu-rows-skeleton-row")).toHaveLength(5);
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
    expect(block.className).toContain("motion-reduce:animate-none");
  });

  it("reserves the file tree's 28px row height", () => {
    render(<MenuRowsSkeleton rows={8} />);
    const rows = screen.getAllByTestId("menu-rows-skeleton-row");
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect((row as HTMLElement).style.height).toBe("28px");
    }
  });

  it("is identical on every render, so screenshots and tests are stable", () => {
    const { container, rerender } = render(<MenuRowsSkeleton />);
    const first = container.innerHTML;

    rerender(<MenuRowsSkeleton />);
    expect(container.innerHTML).toBe(first);
  });
});
