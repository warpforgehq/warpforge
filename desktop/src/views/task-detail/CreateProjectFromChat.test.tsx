import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { daemon } from "@/daemon";
import type { TaskInfo } from "@/protocol";

import { CreateProjectDialog, projectFolderName, projectPathError } from "./CreateProjectFromChat";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn<() => Promise<string | null>>() }));

const chat = {
  agent: "claude",
  blockedReason: null,
  createdAt: 1,
  filesChanged: 0,
  id: "t_chat",
  kind: "chat",
  project: "",
  prompt: "draft a CLI",
  status: "done",
  tags: [],
  title: "Draft a CLI: notes & todos!",
  updatedAt: 1,
} satisfies TaskInfo;

function renderDialog(onCreated = vi.fn<(project: { name: string; path: string }) => void>()) {
  render(<CreateProjectDialog task={chat} onOpenChange={() => {}} onCreated={onCreated} />);
  return onCreated;
}

describe("projectFolderName", () => {
  it("slugs the title and falls back when nothing is left", () => {
    expect(projectFolderName("Draft a CLI: notes & todos!")).toBe("draft-a-cli-notes-todos");
    expect(projectFolderName("???")).toBe("chat-project");
  });
});

describe("projectPathError", () => {
  it("accepts full and home paths only", () => {
    expect(projectPathError("~/workspace/x")).toBeNull();
    expect(projectPathError("/tmp/x")).toBeNull();
    expect(projectPathError("  ")).toBe("Choose a folder for the project.");
    expect(projectPathError("workspace/x")).toBe("Use a full path, like ~/workspace/notes.");
    expect(projectPathError("~/a/../b")).toBe("Remove the .. from the path.");
  });
});

describe("CreateProjectDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to a folder named after the chat, with git on", async () => {
    const create = vi
      .spyOn(daemon, "createProjectFromChat")
      .mockResolvedValue({ name: "draft-a-cli-notes-todos", path: "/Users/me/workspace/x" });
    const onCreated = renderDialog();
    expect(screen.getByLabelText<HTMLInputElement>("Project folder").value).toBe(
      "~/workspace/draft-a-cli-notes-todos",
    );
    await userEvent.setup({ pointerEventsCheck: 0 }).click(screen.getByText("Create project"));
    expect(create).toHaveBeenCalledWith("t_chat", "~/workspace/draft-a-cli-notes-todos", true);
    expect(onCreated).toHaveBeenCalledWith({
      name: "draft-a-cli-notes-todos",
      path: "/Users/me/workspace/x",
    });
  });

  it("refuses a relative path without asking the daemon", async () => {
    const create = vi.spyOn(daemon, "createProjectFromChat");
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderDialog();
    const input = screen.getByLabelText("Project folder");
    await user.clear(input);
    await user.type(input, "notes");
    await user.click(screen.getByText("Initialize git"));
    await user.click(screen.getByText("Create project"));
    expect(screen.getByText("Use a full path, like ~/workspace/notes.")).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it("shows the daemon's refusal of a folder with files and stays open", async () => {
    vi.spyOn(daemon, "createProjectFromChat").mockRejectedValue(
      new Error("/Users/me/workspace/x already exists and is not empty; choose a new folder"),
    );
    const onCreated = renderDialog();
    await userEvent.setup({ pointerEventsCheck: 0 }).click(screen.getByText("Create project"));
    expect(await screen.findByText(/already exists and is not empty/)).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByText("Create project")).toBeTruthy();
  });

  it("sends git off when unchecked", async () => {
    const create = vi
      .spyOn(daemon, "createProjectFromChat")
      .mockResolvedValue({ name: "n", path: "/p" });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderDialog();
    await user.click(screen.getByText("Initialize git"));
    await user.click(screen.getByText("Create project"));
    expect(create).toHaveBeenCalledWith("t_chat", "~/workspace/draft-a-cli-notes-todos", false);
  });
});
