import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

import type { SessionUpdate } from "../../protocol";
import { useTaskFileEditCacheSync, useTaskQueries } from "./useTaskQueries";

describe("useTaskFileEditCacheSync", () => {
  it("invalidates task file queries when a file edit arrives", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const fileEdit: SessionUpdate = {
      additions: 3,
      deletions: 1,
      kind: "file_edit",
      path: "src/new-file.ts",
      tool_call_id: "edit-1",
    };
    const initialUpdates: SessionUpdate[] = [];
    const { rerender } = renderHook(
      ({ updates }: { updates: SessionUpdate[] }) => useTaskFileEditCacheSync("task-1", updates),
      { initialProps: { updates: initialUpdates }, wrapper },
    );

    expect(invalidate).not.toHaveBeenCalled();

    rerender({ updates: [fileEdit] });

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(5));
    expect(invalidate).toHaveBeenNthCalledWith(1, { queryKey: ["diff", "task-1"] });
    expect(invalidate).toHaveBeenNthCalledWith(2, { queryKey: ["fileList", "task-1"] });
    expect(invalidate).toHaveBeenNthCalledWith(3, { queryKey: ["dirList", "task-1"] });
    expect(invalidate).toHaveBeenNthCalledWith(4, { queryKey: ["gitStatus", "task-1"] });
    expect(invalidate).toHaveBeenNthCalledWith(5, {
      queryKey: ["fileContents", "task-1"],
    });

    rerender({
      updates: [fileEdit, { kind: "agent_text", text: "Done" }],
    });

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(5));
  });
});

const { request } = vi.hoisted(() => ({
  request: vi.fn<(method: string, params: unknown) => Promise<unknown>>(),
}));
vi.mock("@/daemon", () => ({ daemon: { request } }));

/** Sized like this repository: 75k paths with ignored files, 2.3k without. */
const ALL_PATHS = Array.from({ length: 75_000 }, (_, i) => `target/debug/deps/lib${i}.rlib`);
const TRACKED_PATHS = Array.from({ length: 2_300 }, (_, i) => `src/module${i}.rs`);

function fileListCalls() {
  return request.mock.calls.filter(([method]) => method === "file.list");
}

describe("useTaskQueries file list", () => {
  function renderQueries() {
    request.mockReset();
    request.mockImplementation((method, params) => {
      if (method === "file.list") {
        const all = (params as { include_ignored?: boolean }).include_ignored;
        return Promise.resolve(
          (all ? ALL_PATHS : TRACKED_PATHS).map((path) => ({ changed: false, path })),
        );
      }
      return Promise.resolve(null);
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      ({ updatedAt }: { updatedAt: number }) =>
        useTaskQueries("task-1", null, { kind: "changes" }, updatedAt),
      { initialProps: { updatedAt: 1 }, wrapper },
    );
    return { hook, queryClient };
  }

  it("holds only the tracked list, never the one with ignored files", async () => {
    const { hook, queryClient } = renderQueries();

    await waitFor(() => expect(hook.result.current.mentionFiles).toHaveLength(2_300));
    expect(fileListCalls().map(([, params]) => params)).toEqual([{ task_id: "task-1" }]);
    const cached = queryClient
      .getQueryCache()
      .getAll()
      .reduce((sum, query) => sum + (JSON.stringify(query.state.data)?.length ?? 0), 0);
    expect(cached).toBeLessThan(200_000);
  });

  it("does not refetch the file list when only the task's updatedAt moves", async () => {
    const { hook } = renderQueries();
    await waitFor(() => expect(hook.result.current.mentionFiles).toHaveLength(2_300));

    for (const updatedAt of [2, 3, 4]) hook.rerender({ updatedAt });
    await waitFor(() =>
      expect(request.mock.calls.filter(([method]) => method === "diff.get").length).toBe(4),
    );
    expect(fileListCalls()).toHaveLength(1);
  });
});
