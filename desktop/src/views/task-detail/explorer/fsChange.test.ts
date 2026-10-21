import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { applyFsChange, type FsChange } from "./fsChange";

function invalidated(subject: { taskId?: string; project?: string }, change: Partial<FsChange>) {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  applyFsChange(queryClient, subject, {
    degraded: false,
    dirs: [],
    index_changed: false,
    rescan: false,
    root: "/r",
    ...change,
  });
  return invalidate.mock.calls.map(([filters]) => filters);
}

describe("applyFsChange", () => {
  it("refetches exactly the named folders and the status", () => {
    expect(invalidated({ taskId: "t1" }, { dirs: ["", "src"] })).toEqual([
      { exact: true, queryKey: ["dirList", "t1", ""] },
      { exact: true, queryKey: ["dirList", "t1", "src"] },
      { queryKey: ["gitStatus", "t1"] },
    ]);
  });

  it("refetches the mention list only when paths came or went", () => {
    expect(invalidated({ project: "demo" }, { dirs: ["src"], index_changed: true })).toContainEqual(
      {
        queryKey: ["projectFileList", "demo"],
      },
    );
    expect(invalidated({ taskId: "t1" }, {})).toEqual([{ queryKey: ["gitStatus", "t1"] }]);
  });

  it("refetches every listing on a rescan", () => {
    expect(invalidated({ taskId: "t1" }, { rescan: true })).toEqual([
      { queryKey: ["dirList", "t1"] },
      { queryKey: ["gitStatus", "t1"] },
      { queryKey: ["fileList", "t1"] },
    ]);
  });
});
