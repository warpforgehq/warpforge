import { createRef } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DiffSurface } from "./DiffSurface";
import type { DiffWorkspaceHandle } from "./DiffWorkspace";

vi.mock("./DiffWorkspace", () => ({
  DiffWorkspace: () => <div data-testid="diff-workspace" />,
}));
vi.mock("../../components/ChangesRail", () => ({
  ChangesRail: () => <div data-testid="changes-rail" />,
}));

function renderSurface() {
  return render(
    <DiffSurface
      commitExpanded={false}
      diff={null}
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
});
