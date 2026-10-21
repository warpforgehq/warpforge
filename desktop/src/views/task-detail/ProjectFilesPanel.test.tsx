import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { explorerFromPaths } from "@/lib/explorerFromPaths";
import { useUi } from "@/store/ui";
import { emitDaemonEvent, request, setDaemonConnection } from "@/test/fakeDaemon";

import { ProjectFilesPanel } from "./ProjectFilesPanel";

vi.mock("@/daemon", () => import("@/test/fakeDaemon"));

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

describe("ProjectFilesPanel live updates", () => {
  function serve(files: string[], degraded = false) {
    const tree = explorerFromPaths(files);
    request.mockImplementation((method, params) =>
      method === "fs.watch" ? Promise.resolve({ degraded, root: "/repo" }) : tree(method, params),
    );
  }
  const callsOf = (method: string) => request.mock.calls.filter(([m]) => m === method);
  const change = (dirs: string[], root = "/repo") =>
    act(() =>
      emitDaemonEvent({
        data: { degraded: false, dirs, index_changed: true, rescan: false, root },
        event: "fs.changed",
      }),
    );

  it("watches its checkout while mounted and stops when it unmounts", async () => {
    serve(["README.md"]);
    const view = wrap(
      <ProjectFilesPanel taskId="t1" selected={null} onSelect={vi.fn<(path: string) => void>()} />,
    );
    await waitFor(() => expect(callsOf("fs.watch")).toEqual([["fs.watch", { task_id: "t1" }]]));

    view.unmount();
    expect(callsOf("fs.unwatch")).toEqual([["fs.unwatch", { task_id: "t1" }]]);
  });

  it("refetches only the folder a change names, for its own root", async () => {
    serve(["README.md", "src/a.ts"]);
    wrap(
      <ProjectFilesPanel taskId="t1" selected={null} onSelect={vi.fn<(path: string) => void>()} />,
    );
    await screen.findByRole("button", { name: "README.md" });
    await waitFor(() => expect(callsOf("fs.watch")).toHaveLength(1));

    serve(["README.md", "NEW.md", "src/a.ts"]);
    await change([""], "/elsewhere");
    expect(screen.queryByRole("button", { name: "NEW.md" })).not.toBeInTheDocument();

    await change([""]);
    expect(await screen.findByRole("button", { name: "NEW.md" })).toBeInTheDocument();
    expect(listedPaths()).toEqual(["", ""]);
  });

  it("watches again after the daemon reconnects", async () => {
    serve(["README.md"]);
    wrap(
      <ProjectFilesPanel taskId="t1" selected={null} onSelect={vi.fn<(path: string) => void>()} />,
    );
    await waitFor(() => expect(callsOf("fs.watch")).toHaveLength(1));

    act(() => setDaemonConnection("disconnected"));
    act(() => setDaemonConnection("connected"));
    await waitFor(() => expect(callsOf("fs.watch")).toHaveLength(2));
  });

  it.each([
    [false, 1],
    [true, 2],
  ])(
    "with degraded=%s, refocusing the window lists the root %i time(s)",
    async (degraded, times) => {
      serve(["README.md"], degraded);
      wrap(
        <ProjectFilesPanel
          taskId="t1"
          selected={null}
          onSelect={vi.fn<(path: string) => void>()}
        />,
      );
      await screen.findByRole("button", { name: "README.md" });
      await waitFor(() => expect(callsOf("fs.watch")).toHaveLength(1));

      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(listedPaths()).toHaveLength(times);
      focusManager.setFocused(undefined);
    },
  );
});
