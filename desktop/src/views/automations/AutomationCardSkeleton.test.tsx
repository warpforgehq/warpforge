import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AutomationCardSkeleton } from "./AutomationCardSkeleton";

describe("AutomationCardSkeleton", () => {
  it("is a busy, announced card shell and never a loading sentence", () => {
    const { container } = render(<AutomationCardSkeleton />);
    const card = screen.getByTestId("automation-card-skeleton");

    expect(card).toHaveAttribute("aria-busy", "true");
    expect(card).toHaveAttribute("role", "status");
    expect(card).toHaveAttribute("aria-label", "Loading automation");
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
    expect(card.className).toContain("motion-reduce:animate-none");
  });

  it("mirrors AutomationCard's card, header, meta row and footer", () => {
    render(<AutomationCardSkeleton />);
    const card = screen.getByTestId("automation-card-skeleton");

    expect(card.className).toContain("rounded-lg");
    expect(card.className).toContain("border");
    expect(card.className).toContain("bg-card");
    // header, badge meta row, schedule lines, footer
    expect(card.children).toHaveLength(4);
    expect(card.firstElementChild!.className).toContain("px-3");
    expect(card.firstElementChild!.className).toContain("pt-3");
    expect(card.lastElementChild!.className).toContain("border-t");
  });

  it("is identical on every render, so screenshots and tests are stable", () => {
    const { container, rerender } = render(<AutomationCardSkeleton />);
    const first = container.innerHTML;

    rerender(<AutomationCardSkeleton />);
    expect(container.innerHTML).toBe(first);
  });
});
