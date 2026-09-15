import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectFilesPanel } from "./ProjectFilesPanel";
import { projectFileParentFolders } from "./projectFileTree";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 28,
      })),
    scrollToIndex: vi.fn<(...args: unknown[]) => void>(),
  }),
}));

describe("projectFileParentFolders", () => {
  it("returns every folder that must be expanded to reveal a nested file", () => {
    expect(projectFileParentFolders("desktop/src/views/TaskDetail.tsx")).toEqual([
      "desktop",
      "desktop/src",
      "desktop/src/views",
    ]);
  });

  it("does not require a folder for a root file", () => {
    expect(projectFileParentFolders("Cargo.toml")).toEqual([]);
  });

  it("keeps a selected file's parent closed after the user collapses it", async () => {
    render(
      <ProjectFilesPanel
        files={[{ path: "desktop/src/TaskDetail.tsx", changed: false }]}
        error={null}
        selected="desktop/src/TaskDetail.tsx"
        onSelect={vi.fn<(path: string) => void>()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "TaskDetail.tsx" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "desktop" }));

    expect(screen.queryByRole("button", { name: "src" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "TaskDetail.tsx" })).not.toBeInTheDocument();
  });
});

describe("ProjectFilesPanel persisted tree state", () => {
  it("restores a stored expansion and prunes one the tree no longer has", async () => {
    const onChange = vi.fn<(next: { expandedDirs: string[] }) => void>();
    render(
      <ProjectFilesPanel
        files={[{ path: "desktop/src/TaskDetail.tsx", changed: false }]}
        error={null}
        selected={null}
        onSelect={vi.fn<(path: string) => void>()}
        treeState={{
          expandedDirs: ["desktop", "desktop/src", "gone-dir"],
          onChange,
          scrollLeft: 0,
          scrollTop: 0,
        }}
      />,
    );

    // The stored expansion survives, so the nested file is visible without a
    // click; the stale "gone-dir" entry is written back out pruned.
    expect(await screen.findByRole("button", { name: "TaskDetail.tsx" })).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ expandedDirs: ["desktop", "desktop/src"] }),
    );
  });
});
