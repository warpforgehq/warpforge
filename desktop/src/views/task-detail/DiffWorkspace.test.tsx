import { render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import type { FileDiff, TaskDiff } from "../../protocol";
import { DiffWorkspace, type DiffWorkspaceHandle } from "./DiffWorkspace";

type OptionSet = {
  count: number;
  estimateSize: (index: number) => number;
  getItemKey?: (index: number) => string | number;
};

const optionSets: OptionSet[] = [];
const measure = vi.fn<() => void>();

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: OptionSet) => {
    optionSets.push(options);
    return {
      getTotalSize: () => 0,
      getVirtualItems: () => [],
      measure,
      measureElement: () => {},
      scrollToIndex: () => {},
    };
  },
}));

vi.mock("./useTaskQueries", () => ({
  useSplitFileQueries: (_taskId: string, files: FileDiff[]) => files.map(() => undefined),
}));

vi.mock("./FileDiffSkeleton", () => ({
  FileDiffSkeleton: () => null,
}));

function taskDiff(paths: string[]): TaskDiff {
  return {
    branch: "main",
    files: paths.map((path) => ({
      hunks: [],
      oldPath: null,
      path,
      status: "modified",
    })),
    ignored: [],
    ignoredAvailable: true,
    ignoredTruncated: false,
    taskId: "task-1",
    untrackedAvailable: true,
    untrackedPaths: [],
  };
}

function renderWorkspace(diff: TaskDiff, collapsedFiles?: ReadonlySet<string>) {
  return render(
    <DiffWorkspace
      diff={diff}
      diffError={null}
      diffView="unified"
      editable
      localRes={{}}
      onOpenFiles={() => {}}
      onResolve={() => {}}
      onSendToChat={() => {}}
      ref={createRef<DiffWorkspaceHandle | null>()}
      taskId="task-1"
      {...(collapsedFiles ? { collapsedFiles } : {})}
    />,
  );
}

describe("DiffWorkspace virtualizer", () => {
  it("keys rows by file path, not by list index", () => {
    optionSets.length = 0;
    renderWorkspace(taskDiff(["src/a.ts", "src/b.ts"]));

    const keys = optionSets.map((options) => options.getItemKey?.(1));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key).toBe("src/b.ts");
  });

  it("does not wipe every measured row when a file is collapsed", () => {
    measure.mockClear();
    const diff = taskDiff(["src/a.ts", "src/b.ts"]);
    const { rerender } = renderWorkspace(diff);

    rerender(
      <DiffWorkspace
        collapsedFiles={new Set(["src/a.ts"])}
        diff={diff}
        diffError={null}
        diffView="unified"
        editable
        localRes={{}}
        onOpenFiles={() => {}}
        onResolve={() => {}}
        onSendToChat={() => {}}
        ref={createRef<DiffWorkspaceHandle | null>()}
        taskId="task-1"
      />,
    );

    // The collapsed row's own ResizeObserver reports its new height; clearing
    // the virtualizer's cache would drop every other row back to its estimate
    // without anything re-measuring it, which is the blank gap/overlap.
    expect(measure).not.toHaveBeenCalled();
  });
});
