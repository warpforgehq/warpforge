import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { daemon } from "../../daemon";
import { FileSystemActionDialog, type FileSystemAction } from "./FileSystemActionDialog";

function renderDialog(action: FileSystemAction, subject: { taskId?: string; project?: string }) {
  const request = vi.spyOn(daemon, "request").mockResolvedValue(null);
  render(
    <FileSystemActionDialog
      action={action}
      taskId={subject.taskId ?? ""}
      project={subject.project}
      onComplete={vi.fn<() => void>()}
      onClose={vi.fn<() => void>()}
    />,
  );
  return request;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FileSystemActionDialog subjects", () => {
  it("creates a file in a project when no task owns the tree", async () => {
    const request = renderDialog({ kind: "create-file", parent: "src" }, { project: "warpforge" });

    fireEvent.change(screen.getByPlaceholderText("name"), { target: { value: "new.ts" } });
    fireEvent.click(screen.getByRole("button", { name: "New File" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("file.create", {
        directory: false,
        path: "src/new.ts",
        project: "warpforge",
      }),
    );
  });

  it("renames in a project", async () => {
    const request = renderDialog({ kind: "rename", path: "src/old.ts" }, { project: "warpforge" });

    fireEvent.change(screen.getByPlaceholderText("name"), { target: { value: "new.ts" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("file.rename", {
        new_path: "src/new.ts",
        path: "src/old.ts",
        project: "warpforge",
      }),
    );
  });

  it("deletes in a project", async () => {
    const request = renderDialog({ kind: "delete", path: "src/old.ts" }, { project: "warpforge" });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("file.delete", {
        path: "src/old.ts",
        project: "warpforge",
      }),
    );
  });

  it("keeps addressing the task when one is open", async () => {
    const request = renderDialog(
      { kind: "delete", path: "src/old.ts" },
      { project: "warpforge", taskId: "task-1" },
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("file.delete", {
        path: "src/old.ts",
        task_id: "task-1",
      }),
    );
  });
});
