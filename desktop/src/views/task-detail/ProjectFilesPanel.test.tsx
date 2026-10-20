import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { explorerFromPaths } from "@/lib/explorerFromPaths";
import { useUi } from "@/store/ui";

import { ProjectFilesPanel } from "./ProjectFilesPanel";

const { request } = vi.hoisted(() => ({
  request: vi.fn<(method: string, params: unknown) => Promise<unknown>>(),
}));
vi.mock("@/daemon", () => ({ daemon: { request } }));

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

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function listedPaths() {
  return request.mock.calls
    .filter(([method]) => method === "dir.list")
    .map(([, params]) => (params as { path: string }).path);
}

beforeEach(() => {
  useUi.setState({ explorerShowIgnored: true });
  request.mockReset();
  request.mockImplementation(
    explorerFromPaths(["desktop/src/TaskDetail.tsx", "README.md", "coverage/lcov.info"], {
      ignored: ["coverage"],
      status: [{ code: " M", path: "desktop/src/TaskDetail.tsx" }],
    }),
  );
});

describe("ProjectFilesPanel", () => {
  it("lists a folder only when it is expanded", async () => {
    wrap(
      <ProjectFilesPanel taskId="t1" selected={null} onSelect={vi.fn<(path: string) => void>()} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "desktop" }));
    expect(await screen.findByRole("button", { name: "src" })).toBeInTheDocument();
    expect(listedPaths()).toEqual(["", "desktop"]);
    expect(request).toHaveBeenCalledWith("dir.list", { path: "desktop", task_id: "t1" });
  });

  it("marks changed files and their folders, and greys ignored entries", async () => {
    wrap(
      <ProjectFilesPanel
        project="demo"
        selected="desktop/src/TaskDetail.tsx"
        onSelect={vi.fn<(path: string) => void>()}
      />,
    );

    const file = await screen.findByRole("button", { name: "TaskDetail.tsx" });
    expect(file).toHaveAttribute("data-status", "modified");
    expect(screen.getByRole("button", { name: "desktop" })).toHaveAttribute(
      "data-status",
      "modified",
    );
    expect(screen.getByRole("button", { name: "coverage" })).toHaveClass("opacity-55");
    expect(request).toHaveBeenCalledWith("git.status", { project: "demo" });
  });

  it("keeps a selected file's parent closed after the user collapses it", async () => {
    wrap(
      <ProjectFilesPanel
        taskId="t1"
        selected="desktop/src/TaskDetail.tsx"
        onSelect={vi.fn<(path: string) => void>()}
      />,
    );

    expect(await screen.findByRole("button", { name: "TaskDetail.tsx" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "desktop" }));

    expect(screen.queryByRole("button", { name: "src" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "TaskDetail.tsx" })).not.toBeInTheDocument();
  });

  it("hides ignored entries for every project when the toggle is off", async () => {
    wrap(
      <ProjectFilesPanel taskId="t1" selected={null} onSelect={vi.fn<(path: string) => void>()} />,
    );

    expect(await screen.findByRole("button", { name: "coverage" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide ignored files" }));

    expect(screen.queryByRole("button", { name: "coverage" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "README.md" })).toBeInTheDocument();
    expect(useUi.getState().explorerShowIgnored).toBe(false);
    expect(listedPaths()).toEqual([""]);

    fireEvent.click(screen.getByRole("button", { name: "Show ignored files" }));
    expect(screen.getByRole("button", { name: "coverage" })).toBeInTheDocument();
  });

  it("opens a file on click", async () => {
    const onSelect = vi.fn<(path: string) => void>();
    wrap(<ProjectFilesPanel taskId="t1" selected={null} onSelect={onSelect} />);

    fireEvent.click(await screen.findByRole("button", { name: "README.md" }));
    expect(onSelect).toHaveBeenCalledWith("README.md");
  });
});

describe("ProjectFilesPanel persisted tree state", () => {
  it("restores a stored expansion and prunes one the tree no longer has", async () => {
    const onChange = vi.fn<(next: { expandedDirs: string[] }) => void>();
    wrap(
      <ProjectFilesPanel
        taskId="t1"
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

    expect(await screen.findByRole("button", { name: "TaskDetail.tsx" })).toBeInTheDocument();
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ expandedDirs: ["desktop", "desktop/src"] }),
      );
    });
  });
});
