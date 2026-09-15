import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FileDiff, FileDoc } from "@/protocol";

import { MergeDiff } from "./MergeDiff";
import { UnifiedDiff } from "./UnifiedDiff";

const doc: FileDoc = {
  newText: "one\ntwo\n",
  oldText: "one\n",
  path: "src/a.ts",
  status: "modified",
};

const file: FileDiff = {
  hunks: [
    {
      lines: ["-", "+two"],
      newLines: 1,
      newStart: 2,
      oldLines: 0,
      oldStart: 2,
      resolution: null,
    },
  ],
  oldPath: null,
  path: "src/a.ts",
  status: "modified",
};

describe("collapsible diff files", () => {
  it("folds a unified diff to its header and reports the toggle", () => {
    const onToggleCollapsed = vi.fn<() => void>();
    render(
      <UnifiedDiff
        collapsed
        doc={doc}
        file={file}
        editable
        onToggleCollapsed={onToggleCollapsed}
        onSave={() => {}}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Expand src/a.ts" });
    fireEvent.click(toggle);
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it("folds a split diff to its header and reports the toggle", () => {
    const onToggleCollapsed = vi.fn<() => void>();
    render(
      <MergeDiff
        collapsed
        doc={doc}
        editable
        file={file}
        onToggleCollapsed={onToggleCollapsed}
        onSave={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand src/a.ts" }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });
});
