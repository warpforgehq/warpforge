import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BodyPicker } from "./BodyPicker";
import type { SidebarSegment } from "./segments";

function renderPicker(segment: SidebarSegment, inboxCount = 0) {
  const onSelect = vi.fn<(segment: SidebarSegment) => void>();
  render(<BodyPicker segment={segment} inboxCount={inboxCount} onSelect={onSelect} />);
  return onSelect;
}

describe("BodyPicker", () => {
  it("offers exactly two segments, so a new destination costs a nav row not a tab", () => {
    renderPicker("tasks");

    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Tasks", "Inbox"]);
  });

  it("marks the active segment and keeps the strip to one tab stop", () => {
    renderPicker("inbox");

    const tasks = screen.getByRole("tab", { name: /^Tasks/ });
    const inbox = screen.getByRole("tab", { name: /^Inbox/ });
    expect(inbox).toHaveAttribute("aria-selected", "true");
    expect(tasks).toHaveAttribute("aria-selected", "false");
    expect(inbox).toHaveAttribute("tabindex", "0");
    expect(tasks).toHaveAttribute("tabindex", "-1");
  });

  it("selects the segment that was clicked", () => {
    const onSelect = renderPicker("tasks");

    fireEvent.click(screen.getByRole("tab", { name: /^Inbox/ }));
    expect(onSelect).toHaveBeenCalledWith("inbox");
  });

  it("walks the segments with the arrow keys and wraps around", () => {
    const onSelect = renderPicker("tasks");

    fireEvent.keyDown(screen.getByRole("tab", { name: /^Tasks/ }), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("inbox");
    expect(screen.getByRole("tab", { name: /^Inbox/ })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("tab", { name: /^Inbox/ }), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith("tasks");
  });

  it("carries the unread count the Inbox nav row used to, and nothing at zero", () => {
    const { unmount } = render(<BodyPicker segment="tasks" inboxCount={7} onSelect={() => {}} />);
    const badge = within(screen.getByRole("tab", { name: /^Inbox/ })).getByText("7");
    expect(badge).toBeInTheDocument();
    // Attention count: 11px, tabular, `warn`.
    expect(badge.className).toContain("text-[11px]");
    expect(badge.className).toContain("tnum");
    expect(badge.className).toContain("text-warn");
    unmount();

    renderPicker("tasks", 0);
    expect(screen.getByRole("tab", { name: /^Inbox/ }).textContent).toBe("Inbox");
  });

  it("reads as a compact segmented control, not content tabs or one big button", () => {
    renderPicker("tasks");

    const list = screen.getByRole("tablist");
    // A short track tightly around the two halves, inset 2px.
    expect(list.className).toContain("rounded-lg");
    expect(list.className).toContain("p-0.5");
    expect(list.className).toContain("bg-muted/70");
    expect(list.className).toContain("dark:bg-muted/60");
    expect(list.className).not.toContain("border");

    const tasks = screen.getByRole("tab", { name: /^Tasks/ });
    const inbox = screen.getByRole("tab", { name: /^Inbox/ });
    // Active: a raised neutral pill — never a `primary` fill, never an
    // underline, so it cannot read as the button below it or as a tab strip.
    // It must be measurably lighter than the track in dark (the theme's own
    // numbers: muted 11%, secondary 15%, accent 20%), or the two halves read
    // as one flat row — `secondary` sat three points off the track and did.
    expect(tasks.className).toContain("bg-background");
    expect(tasks.className).toContain("dark:bg-accent");
    expect(tasks.className).toContain("rounded-md");
    expect(tasks.className).toContain("shadow-sm");
    expect(tasks.className).toContain("text-foreground");
    expect(tasks.className).not.toContain("border");
    expect(tasks.className).not.toContain("bg-primary");
    // Inactive: transparent, and hover brightens the text only.
    expect(inbox.className).toContain("text-muted-foreground");
    expect(inbox.className).toContain("hover:text-foreground");
    expect(inbox.className).not.toContain("bg-");
    // 26px pill + 2px inset each side ≈ a 30px control, under the 32px
    // "New task" button.
    expect(tasks.className).toContain("h-[26px]");
  });
});
