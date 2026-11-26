import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { daemon } from "@/daemon";
import type { TaskInfo } from "@/protocol";
import { useUi } from "@/store/ui";
import { confirmationDefaults } from "@/store/ui/devicePreferences";

import { TaskMenu } from "./TaskMenu";

const task: TaskInfo = {
  agent: "codex",
  blockedReason: null,
  createdAt: 1,
  filesChanged: 0,
  id: "task-1",
  project: "warpforge",
  prompt: "Improve task detail",
  status: "waiting",
  tags: [],
  title: "",
  updatedAt: 1,
};

describe("TaskMenu", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useUi.setState({ confirmations: confirmationDefaults });
  });
  it("names the pin destination explicitly", async () => {
    const user = userEvent.setup();
    render(
      <TaskMenu
        task={task}
        pinned={false}
        onTogglePin={vi.fn<() => void>()}
        onClose={vi.fn<() => void>()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Task actions" }));
    expect(await screen.findByText("Pin to Mission Control")).toBeInTheDocument();
  });

  // Picking Delete used to go straight through: the webview answers
  // `window.confirm` without drawing it, so nothing ever asked.
  it("asks before deleting the task", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn<() => void>();
    const deleteTask = vi.spyOn(daemon, "deleteTask").mockResolvedValue();
    render(
      <TaskMenu task={task} pinned={false} onTogglePin={vi.fn<() => void>()} onClose={onClose} />,
    );

    await user.click(screen.getByRole("button", { name: "Task actions" }));
    await user.click(await screen.findByText("Delete task"));
    expect(deleteTask).not.toHaveBeenCalled();

    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(deleteTask).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Task actions" }));
    await user.click(await screen.findByText("Delete task"));
    await user.click(await screen.findByRole("button", { name: "Delete task" }));
    await vi.waitFor(() => expect(deleteTask).toHaveBeenCalledWith("task-1", false));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("deletes without a dialog when confirmation is off and leaves chat files alone", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn<() => void>();
    const deleteTask = vi.spyOn(daemon, "deleteTask").mockResolvedValue();
    useUi.getState().setConfirmation("deleteTask", false);
    render(
      <TaskMenu
        task={{ ...task, kind: "chat" }}
        pinned={false}
        onTogglePin={() => {}}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Task actions" }));
    await user.click(await screen.findByText("Delete task"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await vi.waitFor(() => expect(deleteTask).toHaveBeenCalledWith("task-1", false));
    expect(onClose).toHaveBeenCalled();
  });

  it("asks before archiving when enabled", async () => {
    const user = userEvent.setup();
    const archiveTask = vi.spyOn(daemon, "archiveTask").mockResolvedValue();
    useUi.getState().setConfirmation("archiveTask", true);
    render(<TaskMenu task={task} pinned={false} onTogglePin={() => {}} onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Task actions" }));
    await user.click(await screen.findByText("Archive task"));
    expect(archiveTask).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Archive task" }));
    expect(archiveTask).toHaveBeenCalledWith(task.id);
  });
});
