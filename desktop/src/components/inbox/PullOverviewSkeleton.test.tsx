import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PullOverviewSkeleton } from "./PullOverviewSkeleton";

describe("PullOverviewSkeleton", () => {
  it("draws five description lines, is busy, and never a loading sentence", () => {
    const { container } = render(<PullOverviewSkeleton variant="description" />);
    const block = screen.getByTestId("pull-description-skeleton");

    expect(block).toHaveAttribute("aria-busy", "true");
    expect(block).toHaveAttribute("role", "status");
    expect(block).toHaveAttribute("aria-label", "Loading description");
    expect(block.children).toHaveLength(5);
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
    expect(block.className).toContain("motion-reduce:animate-none");
  });

  it("draws three activity-card shells with the timeline heading held", () => {
    const { container } = render(<PullOverviewSkeleton variant="activity" />);
    const block = screen.getByTestId("pull-activity-skeleton");

    expect(block).toHaveAttribute("aria-busy", "true");
    expect(block).toHaveAttribute("role", "status");
    expect(block).toHaveAttribute("aria-label", "Loading activity");
    expect(screen.getAllByTestId("pull-activity-skeleton-card")).toHaveLength(3);
    // The live heading survives the swap, so the cards do not jump.
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.queryByText(/Loading activity/)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
  });

  it.each(["description", "activity"] as const)(
    "is identical on every render (%s), so screenshots and tests are stable",
    (variant) => {
      const { container, rerender } = render(<PullOverviewSkeleton variant={variant} />);
      const first = container.innerHTML;

      rerender(<PullOverviewSkeleton variant={variant} />);
      expect(container.innerHTML).toBe(first);
    },
  );
});
