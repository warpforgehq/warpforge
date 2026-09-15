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
    expect(within(screen.getByRole("tab", { name: /^Inbox/ })).getByText("7")).toBeInTheDocument();
    unmount();

    renderPicker("tasks", 0);
    expect(screen.getByRole("tab", { name: /^Inbox/ }).textContent).toBe("Inbox");
  });
});
