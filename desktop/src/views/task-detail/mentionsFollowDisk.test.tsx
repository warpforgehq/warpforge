import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { explorerFromPaths } from "@/lib/explorerFromPaths";
import { emitDaemonEvent, request } from "@/test/fakeDaemon";

import { Composer } from "../../components/Composer";
import { ProjectFilesPanel } from "./ProjectFilesPanel";
import { useTaskQueries } from "./useTaskQueries";

vi.mock("@/daemon", () => import("@/test/fakeDaemon"));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 28 })),
    scrollToIndex: vi.fn<(...args: unknown[]) => void>(),
  }),
}));

let onDisk: string[] = [];

/** The task view with its composer, and the Explorer only while `tree` is on. */
function TaskView({ tree }: { tree: boolean }) {
  const { mentionFiles } = useTaskQueries("t1", null, { kind: "changes" }, 1);
  return (
    <>
      {tree && <ProjectFilesPanel taskId="t1" selected={null} onSelect={() => {}} />}
      <Composer files={mentionFiles} onSend={() => {}} />
    </>
  );
}

function renderView(tree: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TaskView tree={tree} />
    </QueryClientProvider>,
  );
}

function createOnDisk(path: string) {
  onDisk = [...onDisk, path];
  act(() =>
    emitDaemonEvent({
      data: { degraded: false, dirs: [""], index_changed: true, rescan: false, root: "/repo" },
      event: "fs.changed",
    }),
  );
}

function watchCalls() {
  return request.mock.calls.filter(([method]) => method === "fs.watch");
}

beforeEach(() => {
  onDisk = ["README.md"];
  request.mockReset();
  request.mockImplementation((method, params) => {
    if (method === "fs.watch") return Promise.resolve({ degraded: false, root: "/repo" });
    if (method === "file.list") {
      return Promise.resolve(onDisk.map((path) => ({ changed: false, path })));
    }
    if (method === "dir.list" || method === "git.status") {
      return explorerFromPaths(onDisk)(method, params);
    }
    return Promise.resolve(null);
  });
});

describe("the composer's @ list", () => {
  it("offers a file created on disk while the Explorer is not open", async () => {
    renderView(false);
    await vi.waitFor(() => expect(watchCalls()).toEqual([["fs.watch", { task_id: "t1" }]]));

    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox"), "@new");
    expect(screen.queryByText("new.txt")).not.toBeInTheDocument();

    createOnDisk("new.txt");
    expect(await screen.findByText("new.txt", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("shares one watch between the Explorer and the composer", async () => {
    renderView(true);
    await screen.findByRole("button", { name: "README.md" });
    await vi.waitFor(() => expect(watchCalls()).toHaveLength(1));

    createOnDisk("new.txt");
    expect(await screen.findByRole("button", { name: "new.txt" })).toBeInTheDocument();
    const listed = request.mock.calls.filter(([method]) => method === "dir.list");
    expect(listed).toHaveLength(2);
  });
});
