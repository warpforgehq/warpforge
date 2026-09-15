import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChangesRailSkeleton } from "./ChangesRailSkeleton";

describe("ChangesRailSkeleton", () => {
  it("is a busy block that never renders loading text", () => {
    render(<ChangesRailSkeleton />);

    expect(screen.getByTestId("changes-rail-skeleton")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
  });

  it("owns exactly one pulse for the whole tree", () => {
    const { container } = render(<ChangesRailSkeleton />);

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
  });

  it("is identical on every render, so screenshots and tests are stable", () => {
    const { container, rerender } = render(<ChangesRailSkeleton />);
    const first = container.querySelector('[data-testid="changes-rail-skeleton"]')!.innerHTML;

    rerender(<ChangesRailSkeleton />);
    const second = container.querySelector('[data-testid="changes-rail-skeleton"]')!.innerHTML;

    expect(second).toBe(first);
  });

  it("reserves the rail's own chrome: a 36px header and 28px tree rows", () => {
    const { container } = render(<ChangesRailSkeleton />);

    const block = container.querySelector('[data-testid="changes-rail-skeleton"]')!;
    expect(block.querySelector(".h-9")).not.toBeNull();

    const rows = block.querySelectorAll('[style*="height: 28px"]');
    expect(rows).toHaveLength(8);
  });

  it("reserves the tab strip and the staged-count bar the rail mounts with", () => {
    const { container } = render(<ChangesRailSkeleton />);

    const block = container.querySelector('[data-testid="changes-rail-skeleton"]')!;
    // Tab strip, pane header, staged-count bar, tree.
    expect(block.children).toHaveLength(4);
    expect(block.children[0].className).toContain("pt-1");
    expect(block.children[0].children).toHaveLength(3);
    expect(block.children[2].className).toContain("h-8");
    expect(block.children[2].className).toContain("bg-secondary/55");
  });

  it("indents the tree the way FileTreeRow does, so paths do not all start at one x", () => {
    render(<ChangesRailSkeleton />);

    const rows = screen.getAllByTestId("changes-rail-skeleton-row") as HTMLElement[];
    const indents = rows.map((row) => row.style.paddingLeft);
    expect(indents[0]).toBe("8px");
    expect(new Set(indents).size).toBeGreaterThan(1);
  });
});
