import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SURFACE_TABS, type SurfaceTab } from "@/components/workspace";

import { TaskSurfaceHeader } from "./TaskSurfaceHeader";

function renderHeader(overrides: Partial<Parameters<typeof TaskSurfaceHeader>[0]> = {}) {
  const onFocusWorkspace = vi.fn<() => void>();
  const onHideSurface = vi.fn<() => void>();
  const onRestore = vi.fn<() => void>();
  render(
    <TaskSurfaceHeader
      activeSurface="runtime"
      tabs={DEFAULT_SURFACE_TABS}
      workspaceFocused={false}
      onFocusWorkspace={onFocusWorkspace}
      onHideSurface={onHideSurface}
      onRestore={onRestore}
      side="right"
      {...overrides}
    />,
  );
  return { onFocusWorkspace, onHideSurface, onRestore };
}

describe("TaskSurfaceHeader", () => {
  it("names the open surface instead of repeating the whole set", () => {
    renderHeader();

    expect(screen.getByRole("heading", { name: "Runtime" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Runtime" })).toHaveClass("text-[14px]");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("says what the surface holds", () => {
    const tabs: SurfaceTab[] = DEFAULT_SURFACE_TABS.map((tab) =>
      tab.id === "diff" ? { ...tab, count: 4 } : tab,
    );
    const { rerender } = render(
      <TaskSurfaceHeader
        activeSurface="diff"
        tabs={tabs}
        workspaceFocused={false}
        onFocusWorkspace={vi.fn<() => void>()}
        onHideSurface={vi.fn<() => void>()}
        onRestore={vi.fn<() => void>()}
        side="right"
      />,
    );
    expect(screen.getByText("4 changed files")).toBeInTheDocument();

    rerender(
      <TaskSurfaceHeader
        activeSurface="terminal"
        tabs={tabs}
        workspaceFocused={false}
        onFocusWorkspace={vi.fn<() => void>()}
        onHideSurface={vi.fn<() => void>()}
        onRestore={vi.fn<() => void>()}
        side="right"
      />,
    );
    expect(screen.getByText("No sessions")).toBeInTheDocument();
  });

  it("offers separate expand and hide controls while the split is on", () => {
    const { onFocusWorkspace, onHideSurface } = renderHeader();

    fireEvent.click(screen.getByRole("button", { name: "Focus workspace" }));
    expect(onFocusWorkspace).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Hide surface" }));
    expect(onHideSurface).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Restore split view" })).not.toBeInTheDocument();
  });

  it("replaces the pair with a single restore control when the workspace is focused", () => {
    const { onRestore } = renderHeader({ workspaceFocused: true });

    expect(screen.queryByRole("button", { name: "Focus workspace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide surface" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restore split view" }));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("draws the restore glyph on the workspace's own side of the split", () => {
    renderHeader({ side: "left", workspaceFocused: true });

    const restore = screen.getByRole("button", { name: "Restore split view" });
    expect(restore.querySelector("svg")).toHaveClass("lucide-panel-left-dashed");
  });
});
