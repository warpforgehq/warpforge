import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BacklogRowSkeleton } from "./BacklogRowSkeleton";

describe("BacklogRowSkeleton", () => {
  it("fills a cold list with ten rows and never a loading sentence", () => {
    const { container } = render(<BacklogRowSkeleton />);

    expect(screen.getByTestId("backlog-skeleton")).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByTestId("backlog-skeleton-row")).toHaveLength(10);
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
    expect(screen.getByTestId("backlog-skeleton").className).toContain("motion-reduce:animate-none");
  });

  it("stands in for the next page with a single row", () => {
    render(<BacklogRowSkeleton rows={1} />);
    expect(screen.getAllByTestId("backlog-skeleton-row")).toHaveLength(1);
  });

  it("mirrors BacklogRow's h-9 row and its bottom rule", () => {
    render(<BacklogRowSkeleton />);
    const row = screen.getAllByTestId("backlog-skeleton-row")[0];

    expect(row).toHaveStyle({ height: "37px" });
    expect(row.className).toContain("border-b");
    expect(row.className).toContain("border-rule");
    expect(row.className).toContain("pr-2");

    const body = row.firstElementChild!;
    expect(body.className).toContain("h-full");
    expect(body.className).toContain("pl-3");
    expect(body.className).toContain("gap-3");
  });

  it("is identical on every render, so screenshots and tests are stable", () => {
    const { container, rerender } = render(<BacklogRowSkeleton />);
    const first = container.querySelector('[data-testid="backlog-skeleton"]')!.outerHTML;
    const firstRows = container.querySelectorAll('[data-testid="backlog-skeleton-row"]').length;

    rerender(<BacklogRowSkeleton />);
    const second = container.querySelector('[data-testid="backlog-skeleton"]')!.outerHTML;
    const secondRows = container.querySelectorAll('[data-testid="backlog-skeleton-row"]').length;

    expect(second).toBe(first);
    expect(secondRows).toBe(firstRows);
  });
});
