import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { daemon } from "@/daemon";
import type { TaskInfo } from "@/protocol";

import { DeleteTaskDialog } from "./DeleteTaskDialog";

const chat: TaskInfo = {
  agent: "claude",
  blockedReason: null,
  createdAt: 1,
  filesChanged: 0,
  id: "t_chat",
  kind: "chat",
  project: "",
  prompt: "notes",
  status: "waiting",
  tags: [],
  title: "",
  updatedAt: 1,
};

function open(task: TaskInfo, onDeleted = vi.fn<() => void>()) {
  render(
    <DeleteTaskDialog
      task={task}
      label="notes"
      open
      onCancel={vi.fn<() => void>()}
      onDeleted={onDeleted}
    />,
  );
}

describe("DeleteTaskDialog", () => {
  it("deletes a chat's files unless the box is cleared", async () => {
    const user = userEvent.setup();
    vi.spyOn(daemon, "chatFolder").mockResolvedValue({ fileCount: 3, path: "/scratch/t_chat" });
    const deleteTask = vi.spyOn(daemon, "deleteTask").mockResolvedValue();
    open(chat);

    const box = await screen.findByRole("checkbox", { name: "Also delete chat folder (3 files)" });
    expect(box).toBeChecked();
    await user.click(box);
    await user.click(screen.getByRole("button", { name: "Delete chat" }));
    await vi.waitFor(() => expect(deleteTask).toHaveBeenCalledWith("t_chat", false));
  });

  it("asks nothing about an empty folder", async () => {
    const user = userEvent.setup();
    const folder = vi
      .spyOn(daemon, "chatFolder")
      .mockResolvedValue({ fileCount: 0, path: "/scratch/t_chat" });
    const deleteTask = vi.spyOn(daemon, "deleteTask").mockResolvedValue();
    open(chat);

    await vi.waitFor(() => expect(folder).toHaveBeenCalled());
    expect(screen.queryByRole("checkbox")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Delete chat" }));
    await vi.waitFor(() => expect(deleteTask).toHaveBeenCalledWith("t_chat", false));
  });
});
