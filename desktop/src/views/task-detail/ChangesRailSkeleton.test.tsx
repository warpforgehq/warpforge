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
});
