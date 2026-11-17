import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { expect, it } from "vitest";

import type { TaskDiff } from "@/protocol";

import { CommitWorkspace } from "./CommitWorkspace";
import type { DiffWorkspaceHandle } from "./WorkingWorkspace";

it("renders the historical patch without fetching working file contents or offering resolve", () => {
  const diff = {
    files: [
      {
        path: "removed.txt",
        status: "deleted",
        oldPath: null,
        hunks: [
          {
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: ["-old historical content", "+new historical content"],
          },
        ],
      },
    ],
  } as TaskDiff;
  const { rerender } = render(
    <CommitWorkspace
      ref={createRef<DiffWorkspaceHandle>()}
      diff={diff}
      diffError={null}
      diffView="unified"
      editable={false}
      localRes={{}}
      taskId="t1"
      onOpenFiles={() => {}}
      onResolve={() => {}}
      onSendToChat={() => {}}
    />,
  );
  expect(screen.getByText("old historical content")).toBeInTheDocument();
  expect(screen.getByText("new historical content")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /accept|reject|save/i })).not.toBeInTheDocument();
  rerender(
    <CommitWorkspace
      diff={diff}
      diffError={null}
      diffView="split"
      editable={false}
      localRes={{}}
      taskId="t1"
      onOpenFiles={() => {}}
      onResolve={() => {}}
      onSendToChat={() => {}}
    />,
  );
  expect(screen.getByText("new historical content")).toBeInTheDocument();
});
