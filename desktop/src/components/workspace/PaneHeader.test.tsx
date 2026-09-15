import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PaneHeader } from "./PaneHeader";

describe("PaneHeader", () => {
  it("is the one 36px chrome row: rule underline, 12px gutter, no background", () => {
    render(<PaneHeader title="Files" data-testid="header" />);

    const header = screen.getByTestId("header");
    expect(header.tagName).toBe("HEADER");
    expect(header).toHaveAttribute("data-pane-header");
    expect(header.className).toContain("h-9");
    expect(header.className).toContain("border-border");
    expect(header.className).toContain("px-3");
    expect(header.className).not.toMatch(/\bbg-/);
  });

  it("uses the title type and puts actions on the right", () => {
    render(<PaneHeader title="Conversation" actions={<button type="button">Open</button>} />);

    expect(screen.getByRole("heading", { name: "Conversation" }).className).toContain("text-[15px]");
    const actions = screen.getByRole("button", { name: "Open" }).parentElement!;
    expect(actions.className).toContain("ml-auto");
  });

  it("renders a mono title for path headers", () => {
    render(<PaneHeader mono title="src/app.ts" />);

    expect(screen.getByRole("heading").className).toContain("font-mono");
  });
});
