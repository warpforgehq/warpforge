import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PullRequestRowSkeleton } from "./PullRequestRowSkeleton";

describe("PullRequestRowSkeleton", () => {
  it("renders a busy list of eight rows and never a loading sentence", () => {
    const { container } = render(<PullRequestRowSkeleton />);

    expect(screen.getByTestId("pull-request-skeleton")).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByTestId("pull-request-skeleton-row")).toHaveLength(8);
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
    expect(screen.getByTestId("pull-request-skeleton").className).toContain(
      "motion-reduce:animate-none",
    );
  });

  it("reuses the real list's scroller so the gutters do not move on swap", () => {
    render(<PullRequestRowSkeleton />);
    const scroller = screen.getByTestId("pull-request-skeleton").parentElement!;

    expect(scroller.className).toContain("h-full");
    expect(scroller.className).toContain("overflow-y-auto");
    expect(scroller.className).toContain("px-2");
    expect(scroller.className).toContain("py-2");
    expect(scroller.className).toContain("[scrollbar-gutter:stable]");
  });

  it("mirrors PullRequestRow's row box and two-line composition", () => {
    render(<PullRequestRowSkeleton />);
    const row = screen.getAllByTestId("pull-request-skeleton-row")[0];

    expect(row.className).toContain("rounded-md");
    expect(row.className).toContain("px-2");
    expect(row.className).toContain("py-1.5");
    expect(row.className).toContain("gap-1");
    expect(row.className).not.toContain("leading-none");
    expect(row.className).not.toContain("border-b");
    expect(row.children).toHaveLength(2);

    const meta = row.firstElementChild!;
    expect(meta.className).toContain("text-[10px]");
    expect(meta.className).toContain("leading-[14px]");
    // The status lane is reserved even while empty, so a row with a glyph does
    // not shift the age lane left.
    expect(meta.querySelector('[data-lane="status"]')).not.toBeNull();
  });

  it("varies the repo lane instead of collapsing every row onto one width", () => {
    render(<PullRequestRowSkeleton />);
    const widths = screen
      .getAllByTestId("pull-request-skeleton-row")
      .map((row) => (row.firstElementChild!.children[1] as HTMLElement).style.width);

    expect(new Set(widths).size).toBeGreaterThan(4);
  });

  it("gives the title line the real row's 16px box", () => {
    render(<PullRequestRowSkeleton />);
    const title = screen.getAllByTestId("pull-request-skeleton-row")[0].lastElementChild!;

    expect(title.className).toContain("h-4");
    expect(title.className).toContain("leading-4");
  });

  it("is identical on every render, so screenshots and tests are stable", () => {
    const { container, rerender } = render(<PullRequestRowSkeleton />);
    const first = container.querySelector('[data-testid="pull-request-skeleton"]')!.outerHTML;
    const firstRows = container.querySelectorAll(
      '[data-testid="pull-request-skeleton-row"]',
    ).length;

    rerender(<PullRequestRowSkeleton />);
    const second = container.querySelector('[data-testid="pull-request-skeleton"]')!.outerHTML;
    const secondRows = container.querySelectorAll(
      '[data-testid="pull-request-skeleton-row"]',
    ).length;

    expect(second).toBe(first);
    expect(secondRows).toBe(firstRows);
  });
});
