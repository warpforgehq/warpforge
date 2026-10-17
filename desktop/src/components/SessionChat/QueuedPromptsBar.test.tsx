import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QueuedPrompt } from "@/protocol";

const { request, toastError, toastSuccess } = vi.hoisted(() => ({
  request: vi.fn<(method: string, params: unknown) => Promise<unknown>>(),
  toastError: vi.fn<(message: string) => void>(),
  toastSuccess: vi.fn<(message: string, options?: unknown) => void>(),
}));
vi.mock("@/daemon", () => ({ daemon: { request } }));
vi.mock("../../daemon", () => ({ daemon: { request } }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

import { QueuedPromptsBar } from "./QueuedPromptsBar";

const waiting = (id: string, text: string, initiator: QueuedPrompt["initiator"] = "user") => ({
  id,
  initiator,
  text,
});

/** Run the Undo action attached to the "removed" toast. */
function clickUndo() {
  const calls = toastSuccess.mock.calls;
  const options = calls[calls.length - 1]?.[1] as { action?: { onClick?: () => void } } | undefined;
  options?.action?.onClick?.();
}

describe("QueuedPromptsBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    request.mockResolvedValue(undefined);
  });

  it("shows nothing when no message is waiting", () => {
    const { container } = render(<QueuedPromptsBar taskId="t1" queued={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows every waiting message in full, in order", () => {
    render(
      <QueuedPromptsBar
        taskId="t1"
        queued={[waiting("q1", "rebase onto main"), waiting("q2", "and run the tests")]}
      />,
    );
    expect(screen.getByText("2 messages waiting for the agent")).toBeInTheDocument();
    const texts = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(texts).toEqual(["rebase onto main", "and run the tests"]);
  });

  it("names the sender of a message nobody typed", () => {
    render(<QueuedPromptsBar taskId="t1" queued={[waiting("q1", "nightly", "automation")]} />);
    expect(screen.getByText("Scheduled run")).toBeInTheDocument();
  });

  it("sends the whole queue now", async () => {
    render(<QueuedPromptsBar taskId="t1" queued={[waiting("q1", "a"), waiting("q2", "b")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Send all now" }));
    expect(request).toHaveBeenCalledWith("session.interrupt", { task_id: "t1" });
  });

  it("surfaces a refusal instead of looking like a dead button", async () => {
    request.mockRejectedValue(new Error("nothing is waiting to be sent"));
    render(<QueuedPromptsBar taskId="t1" queued={[waiting("q1", "a")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Send now" }));
    expect(toastError).toHaveBeenCalledWith("nothing is waiting to be sent");
  });

  it("removes a waiting message and offers an undo", async () => {
    render(<QueuedPromptsBar taskId="t1" queued={[waiting("q1", "rebase onto main")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove queued message" }));
    expect(request).toHaveBeenCalledWith("session.removeQueued", {
      task_id: "t1",
      queued_id: "q1",
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      "Queued message removed",
      expect.objectContaining({ action: expect.anything() }),
    );
  });

  it("puts the message back at the end when the removal is undone", async () => {
    render(<QueuedPromptsBar taskId="t1" queued={[waiting("q1", "rebase onto main")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove queued message" }));
    request.mockClear();
    clickUndo();
    expect(request).toHaveBeenCalledWith("session.prompt", {
      task_id: "t1",
      text: "rebase onto main",
      attachments: [],
    });
  });

  it("reports an already-sent message on remove instead of a removal toast", async () => {
    request.mockRejectedValue(new Error("that message was already sent"));
    render(<QueuedPromptsBar taskId="t1" queued={[waiting("q1", "a")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove queued message" }));
    expect(toastError).toHaveBeenCalledWith("Already sent");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("edits a waiting message and saves the new text", async () => {
    render(<QueuedPromptsBar taskId="t1" queued={[waiting("q1", "rebase onto main")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit queued message" }));
    const editor = screen.getByRole("textbox");
    await userEvent.clear(editor);
    await userEvent.type(editor, "rebase onto release");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(request).toHaveBeenCalledWith("session.editQueued", {
      task_id: "t1",
      queued_id: "q1",
      text: "rebase onto release",
    });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("saves the edit with the keyboard shortcut", async () => {
    render(<QueuedPromptsBar taskId="t1" queued={[waiting("q1", "rebase onto main")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit queued message" }));
    const editor = screen.getByRole("textbox");
    await userEvent.clear(editor);
    await userEvent.type(editor, "rebase onto release");
    fireEvent.keyDown(editor, { key: "Enter", metaKey: true });
    expect(request).toHaveBeenCalledWith("session.editQueued", {
      task_id: "t1",
      queued_id: "q1",
      text: "rebase onto release",
    });
  });

  it("cancels an edit with Escape without saving", async () => {
    render(<QueuedPromptsBar taskId="t1" queued={[waiting("q1", "rebase onto main")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit queued message" }));
    const editor = screen.getByRole("textbox");
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(request).not.toHaveBeenCalledWith("session.editQueued", expect.anything());
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("rebase onto main")).toBeInTheDocument();
  });

  it("reports an already-sent message on save", async () => {
    request.mockRejectedValue(new Error("that message was already sent"));
    render(<QueuedPromptsBar taskId="t1" queued={[waiting("q1", "a")]} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit queued message" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(toastError).toHaveBeenCalledWith("Already sent");
  });

  it("shows attachments on a waiting message read-only", () => {
    render(
      <QueuedPromptsBar
        taskId="t1"
        queued={[
          {
            ...waiting("q1", "see attached"),
            attachments: [{ type: "file", path: "src/main.rs" }],
          },
        ]}
      />,
    );
    expect(screen.getByText("src/main.rs")).toBeInTheDocument();
  });

  it("shows a peer message without edit or send-now, but still removable", async () => {
    render(<QueuedPromptsBar taskId="t1" queued={[waiting("q1", "API is ready", "peer")]} />);
    expect(screen.getByText("Peer message")).toBeInTheDocument();
    expect(screen.getByText("API is ready")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit queued message" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send now" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove queued message" }));
    expect(request).toHaveBeenCalledWith("session.removeQueued", {
      task_id: "t1",
      queued_id: "q1",
    });
    expect(toastSuccess).toHaveBeenCalledWith("Queued message removed", undefined);
  });

  it("keeps send-now for the user's message queued beside a peer one", () => {
    render(
      <QueuedPromptsBar
        taskId="t1"
        queued={[waiting("q1", "API is ready", "peer"), waiting("q2", "and run the tests")]}
      />,
    );
    expect(screen.getByRole("button", { name: "Send all now" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit queued message" })).toHaveLength(1);
  });
});
