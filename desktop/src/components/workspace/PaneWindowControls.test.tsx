import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaneWindowControls, type PaneWindowControlsProps } from "./PaneWindowControls";

function renderControls(focused: boolean) {
  const props: PaneWindowControlsProps = {
    expandLabel: "Focus pane",
    focused,
    hideLabel: "Hide pane",
    onExpand: vi.fn<() => void>(),
    onHide: vi.fn<() => void>(),
    onRestore: vi.fn<() => void>(),
  };
  render(<PaneWindowControls {...props} />);
  return props;
}

describe("PaneWindowControls", () => {
  it("offers expand and hide while the split is on", () => {
    const { onExpand, onHide, onRestore } = renderControls(false);

    fireEvent.click(screen.getByRole("button", { name: "Focus pane" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide pane" }));

    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onRestore).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("collapses to a single restore control while focused", () => {
    const { onRestore } = renderControls(true);

    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Restore split view" }));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });
});
