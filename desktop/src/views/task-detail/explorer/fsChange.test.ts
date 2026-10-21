import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyFsChange, TRACKED_REFRESH_MS, type FsChange } from "./fsChange";

function change(over: Partial<FsChange> = {}): FsChange {
  return { degraded: false, dirs: [], index_changed: false, rescan: false, root: "/r", ...over };
}

function invalidated(subject: { taskId?: string; project?: string }, over: Partial<FsChange>) {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  applyFsChange(queryClient, subject, change(over));
  vi.advanceTimersByTime(TRACKED_REFRESH_MS);
  return invalidate.mock.calls.map(([filters]) => filters);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("applyFsChange", () => {
  it("refetches the named folders and the status, then the mention list", () => {
    expect(invalidated({ taskId: "t1" }, { dirs: ["", "src"] })).toEqual([
      { exact: true, queryKey: ["dirList", "t1", ""] },
      { exact: true, queryKey: ["dirList", "t1", "src"] },
      { queryKey: ["gitStatus", "t1"] },
      { queryKey: ["fileList", "t1"] },
    ]);
  });

  it("leaves the mention list alone when only file contents changed", () => {
    expect(invalidated({ taskId: "t1" }, {})).toEqual([{ queryKey: ["gitStatus", "t1"] }]);
    expect(invalidated({ project: "demo" }, { index_changed: true })).toContainEqual({
      queryKey: ["projectFileList", "demo"],
    });
  });

  it("refetches every listing on a rescan", () => {
    expect(invalidated({ taskId: "t1" }, { rescan: true })).toEqual([
      { queryKey: ["dirList", "t1"] },
      { queryKey: ["gitStatus", "t1"] },
      { queryKey: ["fileList", "t1"] },
    ]);
  });
});

describe("applyFsChange and the mention list", () => {
  function observedTrackedList() {
    const queryClient = new QueryClient();
    const queryFn = vi.fn<() => Promise<string[]>>().mockResolvedValue(["new.txt"]);
    const observer = new QueryObserver(queryClient, {
      queryFn,
      queryKey: ["fileList", "t1", "tracked"],
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    return { queryClient, queryFn, unsubscribe };
  }

  it("refetches it after a new untracked file appears", async () => {
    const { queryClient, queryFn, unsubscribe } = observedTrackedList();
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    applyFsChange(queryClient, { taskId: "t1" }, change({ dirs: [""], index_changed: true }));
    await vi.advanceTimersByTimeAsync(TRACKED_REFRESH_MS);

    expect(queryFn).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("refetches it once for a burst of twenty changes", async () => {
    const { queryClient, queryFn, unsubscribe } = observedTrackedList();
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    for (let i = 0; i < 20; i += 1) {
      applyFsChange(queryClient, { taskId: "t1" }, change({ dirs: [`gen/${i}`] }));
      await vi.advanceTimersByTimeAsync(TRACKED_REFRESH_MS / 40);
    }
    await vi.advanceTimersByTimeAsync(TRACKED_REFRESH_MS);

    expect(queryFn).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
