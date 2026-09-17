import { render, screen } from "@testing-library/react";
import { FolderTree } from "lucide-react";
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

    expect(screen.getByRole("heading", { name: "Conversation" }).className).toContain(
      "text-[15px]",
    );
    const actions = screen.getByRole("button", { name: "Open" }).parentElement!;
    expect(actions.className).toContain("ml-auto");
  });

  it("supports a local compact title without changing the shared default", () => {
    render(<PaneHeader title="Conversation" titleSize="compact" />);
    expect(screen.getByRole("heading")).toHaveClass("text-[14px]");
  });

  it("renders a mono title for path headers", () => {
    render(<PaneHeader mono title="src/app.ts" />);

    expect(screen.getByRole("heading").className).toContain("font-mono");
  });

  it("sits the subtitle on the title's baseline, not on its box centre", () => {
    render(<PaneHeader icon={FolderTree} title="Explorer" subtitle="Project tree and editor" />);

    const subtitle = screen.getByText("Project tree and editor");
    const row = subtitle.parentElement!;
    expect(row.className).toContain("items-baseline");
    expect(row.className).not.toContain("items-center");
    expect(row.querySelector("svg")?.className.baseVal).toContain("self-center");
  });
});
