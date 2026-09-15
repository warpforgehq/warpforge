import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SettingsListSkeleton } from "./SettingsListSkeleton";

describe("SettingsListSkeleton", () => {
  it("is a busy, announced list of rows and never a loading sentence", () => {
    const { container } = render(<SettingsListSkeleton rows={4} label="Loading agents" />);
    const block = screen.getByTestId("settings-list-skeleton");

    expect(block).toHaveAttribute("aria-busy", "true");
    expect(block).toHaveAttribute("role", "status");
    expect(block).toHaveAttribute("aria-label", "Loading agents");
    expect(screen.getAllByTestId("settings-list-skeleton-row")).toHaveLength(4);
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
    expect(block.className).toContain("motion-reduce:animate-none");
  });

  it("mirrors the real rows' px-4 py-2.5 rhythm and dividers", () => {
    render(<SettingsListSkeleton rows={4} />);
    const row = screen.getAllByTestId("settings-list-skeleton-row")[0];

    expect(row.className).toContain("px-4");
    expect(row.className).toContain("py-2.5");
    expect(row.className).toContain("border-t");
    expect(row.className).toContain("first:border-t-0");
    expect(row.children).toHaveLength(2);
  });

  it("is identical on every render, so screenshots and tests are stable", () => {
    const { container, rerender } = render(<SettingsListSkeleton />);
    const first = container.innerHTML;

    rerender(<SettingsListSkeleton />);
    expect(container.innerHTML).toBe(first);
  });
});
