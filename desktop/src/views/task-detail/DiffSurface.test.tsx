import { render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import type { FileDiff, TaskDiff } from "../../protocol";
import { DiffSurface } from "./DiffSurface";
import type { DiffWorkspaceHandle } from "./DiffWorkspace";

vi.mock("./DiffWorkspace", () => ({
  DiffWorkspace: () => <div data-testid="diff-workspace" />,
  estimateFileHeight: () => 384,
}));
vi.mock("./FileDiffSkeleton", () => ({
  FileDiffSkeleton: ({ index }: { index: number }) => (
    <div data-testid="file-skeleton" data-index={index} />
  ),
}));
vi.mock("../../components/ChangesRail", () => ({
  ChangesRail: () => <div data-testid="changes-rail" />,
}));

function taskDiff(count: number): TaskDiff {
  const files: FileDiff[] = Array.from({ length: count }, (_, index) => ({
    hunks: [],
    oldPath: null,
    path: `src/file-${index}.ts`,
    status: "modified",
  }));
  return {
    branch: "main",
    files,
    ignored: [],
    ignoredAvailable: true,
    ignoredTruncated: false,
    taskId: "task-1",
    untrackedAvailable: true,
    untrackedPaths: [],
  };
}

function renderSurface(overrides: { diff?: TaskDiff | null } = {}) {
  return render(
    <DiffSurface
      commitExpanded={false}
      diff={overrides.diff ?? null}
      diffError={null}
      diffView="unified"
      diffWorkspaceRef={createRef<DiffWorkspaceHandle | null>()}
      editable
      localRes={{}}
      onCommitExpandedChange={() => {}}
      onCommitted={() => {}}
      onOpenFile={() => {}}
      onOpenFiles={() => {}}
      onRefresh={() => {}}
      onResolve={() => {}}
      onSelect={() => {}}
      onSendToChat={() => {}}
      onSetDiffView={() => {}}
      project="warpforge"
      selected={null}
      taskId="task-1"
    />,
  );
}

describe("DiffSurface", () => {
  it("paints the shell first and mounts the workspace a frame later", async () => {
    renderSurface();

    // The turn Inbox → Tasks is genuinely synchronous: the shell and its
    // skeleton commit before the diff's editors are asked to mount.
    expect(screen.getByTestId("diff-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("diff-workspace")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("diff-workspace")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("diff-skeleton")).not.toBeInTheDocument();
  });

  it("shows one file skeleton per loading file, never per-file loading text", () => {
    renderSurface({ diff: taskDiff(3) });

    expect(screen.getAllByTestId("file-skeleton")).toHaveLength(3);
    expect(screen.queryByText(/Loading /)).not.toBeInTheDocument();
  });

  it("caps the shell skeleton and still draws some before a diff arrives", () => {
    const { unmount } = renderSurface({ diff: taskDiff(20) });
    expect(screen.getAllByTestId("file-skeleton")).toHaveLength(6);
    unmount();

    renderSurface();
    expect(screen.getAllByTestId("file-skeleton")).toHaveLength(3);
  });
});
