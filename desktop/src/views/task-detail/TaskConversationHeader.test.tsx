import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskConversationHeader } from "./TaskConversationHeader";

function renderHeader(showDiff: boolean, side: "left" | "right" = "left") {
  const setShowDiff = vi.fn<(show: boolean) => void>();
  const toggleChat = vi.fn<() => void>();
  render(
    <TaskConversationHeader
      showDiff={showDiff}
      setShowDiff={setShowDiff}
      toggleChat={toggleChat}
      side={side}
      extraActions={<button type="button">Agents</button>}
    />,
  );
  return { setShowDiff, toggleChat };
}

describe("TaskConversationHeader", () => {
  it("focuses the conversation by folding the workspace away", () => {
    const { setShowDiff, toggleChat } = renderHeader(true);

    fireEvent.click(screen.getByRole("button", { name: "Focus conversation" }));
    expect(setShowDiff).toHaveBeenCalledWith(false);
    expect(toggleChat).not.toHaveBeenCalled();
  });

  it("hides the conversation so the workspace takes the full width", () => {
    const { setShowDiff, toggleChat } = renderHeader(true);

    fireEvent.click(screen.getByRole("button", { name: "Hide conversation" }));
    expect(toggleChat).toHaveBeenCalledTimes(1);
    expect(setShowDiff).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Restore split view" })).not.toBeInTheDocument();
  });

  it("offers a single restore control while the conversation is focused", () => {
    const { setShowDiff } = renderHeader(false);

    expect(screen.queryByRole("button", { name: "Focus conversation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide conversation" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restore split view" }));
    expect(setShowDiff).toHaveBeenCalledWith(true);
  });

  it("keeps the extra actions ahead of the window controls", () => {
    renderHeader(true);

    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent || button.title);
    expect(labels).toEqual(["Agents", "Focus conversation", "Hide conversation"]);
  });

  it("draws the restore glyph on the conversation's own side of the split", () => {
    renderHeader(false, "right");

    const restore = screen.getByRole("button", { name: "Restore split view" });
    expect(restore.querySelector("svg")).toHaveClass("lucide-panel-right-dashed");
  });
});
