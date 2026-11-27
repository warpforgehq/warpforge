import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DEFAULT_SURFACE_TABS, type SurfaceTab } from "@/components/workspace";

import { TaskSurfaceHeader } from "./TaskSurfaceHeader";

describe("TaskSurfaceHeader", () => {
  it("names the open surface instead of repeating the whole set", () => {
    render(<TaskSurfaceHeader activeSurface="runtime" tabs={DEFAULT_SURFACE_TABS} />);

    expect(screen.getByRole("heading", { name: "Runtime" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("shows the name alone, without a summary or window controls", () => {
    const tabs: SurfaceTab[] = DEFAULT_SURFACE_TABS.map((tab) =>
      tab.id === "diff" ? { ...tab, count: 4 } : tab,
    );
    render(<TaskSurfaceHeader activeSurface="diff" tabs={tabs} />);

    expect(screen.queryByText("4 changed files")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
