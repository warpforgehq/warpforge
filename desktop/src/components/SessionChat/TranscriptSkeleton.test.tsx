import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TranscriptSkeleton } from "./TranscriptSkeleton";

describe("TranscriptSkeleton", () => {
  it("keeps the transcript's status semantics and drops the loading sentence", () => {
    render(<TranscriptSkeleton />);

    const block = screen.getByTestId("transcript-skeleton");
    expect(block).toHaveAttribute("role", "status");
    expect(block).toHaveAttribute("aria-label", "Loading conversation");
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
  });

  it("pulses once and goes static under reduced motion", () => {
    const { container } = render(<TranscriptSkeleton />);

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
    expect(screen.getByTestId("transcript-skeleton").className).toContain(
      "motion-reduce:animate-none",
    );
  });

  it("is bottom-anchored in the transcript's own measure", () => {
    render(<TranscriptSkeleton />);
    const block = screen.getByTestId("transcript-skeleton");

    expect(block.className).toContain("justify-end");
    expect(block.className).toContain("px-2");
    expect(block.className).toContain("text-sm");
    expect(screen.getAllByTestId("transcript-skeleton-block")).toHaveLength(4);
  });

  it("is identical on every render, so the swap does not repaint a different shape", () => {
    const { container, rerender } = render(<TranscriptSkeleton />);
    const first = container.querySelector('[data-testid="transcript-skeleton"]')!.outerHTML;
    const firstBars = container.querySelectorAll('[data-testid="transcript-skeleton"] span').length;

    rerender(<TranscriptSkeleton />);
    const second = container.querySelector('[data-testid="transcript-skeleton"]')!.outerHTML;
    const secondBars = container.querySelectorAll(
      '[data-testid="transcript-skeleton"] span',
    ).length;

    expect(second).toBe(first);
    expect(secondBars).toBe(firstBars);
  });
});
