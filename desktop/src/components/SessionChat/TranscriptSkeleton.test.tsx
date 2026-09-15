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
    // The list's own footer height, so the last block sits where the last
    // message will.
    expect(block.className).toContain("pb-14");
    expect(screen.getAllByTestId("transcript-skeleton-block")).toHaveLength(5);
  });

  it("reads as a conversation: own messages inset right, agent prose full measure", () => {
    render(<TranscriptSkeleton />);
    const blocks = screen.getAllByTestId("transcript-skeleton-block");
    const own = blocks.filter((block) => block.dataset.kind === "user");
    const agent = blocks.filter((block) => block.dataset.kind === "agent");
    const work = blocks.filter((block) => block.dataset.kind === "work");

    expect(own).toHaveLength(2);
    expect(agent).toHaveLength(2);
    expect(work).toHaveLength(1);

    for (const block of own) {
      expect(block.className).toContain("ml-auto");
      expect(block.className).toContain("max-w-[90%]");
      // `StreamLine`'s own-message card, so the real one lands on this shape.
      expect(block.firstElementChild!.className).toContain("bg-primary/10");
      expect(block.firstElementChild!.className).toContain("rounded-md");
    }
    for (const block of agent) {
      expect(block.className).toContain("w-full");
      expect(block.className).not.toContain("ml-auto");
    }
  });

  it("gives every prose line the chat's 24px line box and 2–4 line paragraphs", () => {
    render(<TranscriptSkeleton />);
    const blocks = screen.getAllByTestId("transcript-skeleton-block");

    const lines = blocks.flatMap((block) =>
      [...block.querySelectorAll("span")].filter((node) => node.style.height === "24px"),
    );
    expect(lines.length).toBeGreaterThan(0);

    const paragraphs = blocks
      .filter((block) => block.dataset.kind === "agent")
      .flatMap((block) => [...block.children]);
    for (const paragraph of paragraphs) {
      expect(paragraph.children.length).toBeGreaterThanOrEqual(2);
      expect(paragraph.children.length).toBeLessThanOrEqual(4);
    }
    // Paragraphs after the first carry the typeset flow gap.
    expect(paragraphs.filter((p) => p.className.includes("mt-3"))).toHaveLength(1);
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
