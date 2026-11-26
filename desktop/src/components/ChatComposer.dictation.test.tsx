import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskInfo } from "../protocol";
import { ChatComposer } from "./ChatComposer";

const request = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({}));
const invoke = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>();
const listeners = new Map<string, (event: { payload: unknown }) => void>();

vi.mock("../daemon", () => ({
  daemon: { request: (...args: unknown[]) => request(...(args as [])) },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: Record<string, unknown>) => invoke(command, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(name, handler);
    return () => listeners.delete(name);
  },
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn<() => void>(), info: vi.fn<() => void>(), success: vi.fn<() => void>() },
}));

const task: TaskInfo = {
  agent: "claude",
  blockedReason: null,
  createdAt: 1,
  filesChanged: 0,
  id: "t_1",
  project: "warpforge",
  prompt: "do it",
  status: "running",
  tags: [],
  title: "",
  updatedAt: 1,
};

function shell(opts: { installed: boolean; transcript?: string }) {
  invoke.mockImplementation(async (command) => {
    switch (command) {
      case "dictation_models":
        return [
          {
            id: "large-v3-turbo-q5_0",
            label: "Large v3 Turbo",
            description: "",
            sizeBytes: 1,
            installed: opts.installed,
            isDefault: true,
          },
        ];
      case "dictation_stop":
        return opts.transcript ?? "";
      default:
        return undefined;
    }
  });
}

function renderComposer() {
  return render(
    <ChatComposer
      commands={[]}
      files={[]}
      filesLoading={false}
      imageSupported={false}
      onBeforeSend={vi.fn<() => void>()}
      task={task}
    />,
  );
}

function commands() {
  return invoke.mock.calls.map(([command]) => command);
}

describe("ChatComposer — dictation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("inserts the transcript at the cursor without sending", async () => {
    shell({ installed: true, transcript: "зроби commit" });
    const user = userEvent.setup();
    renderComposer();
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    await user.type(box, "Please now");
    box.setSelectionRange(6, 6);

    await user.click(screen.getByRole("button", { name: "Dictate" }));
    expect(await screen.findByRole("status", { name: "Recording" })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("dictation_start", { device: null });

    await act(async () => {
      listeners.get("dictation:level")?.({ payload: { level: 0.5, elapsedMs: 3_000 } });
    });
    expect(screen.getByText("0:03")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop dictation" }));
    await waitFor(() => expect(box.value).toBe("Please зроби commit now"));
    expect(invoke).toHaveBeenCalledWith(
      "dictation_stop",
      expect.objectContaining({ model: "large-v3-turbo-q5_0", language: "auto" }),
    );
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Dictate" })).toBeInTheDocument();
  });

  it("cancels on Escape and leaves the draft alone", async () => {
    shell({ installed: true, transcript: "never" });
    const user = userEvent.setup();
    renderComposer();
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    await user.type(box, "draft");

    await user.click(screen.getByRole("button", { name: "Dictate" }));
    await screen.findByRole("status", { name: "Recording" });
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(commands()).toContain("dictation_cancel"));
    expect(commands()).not.toContain("dictation_stop");
    expect(await screen.findByRole("button", { name: "Dictate" })).toBeInTheDocument();
    expect(box.value).toBe("draft");
  });

  it("offers the default model download when none is installed", async () => {
    shell({ installed: false });
    const user = userEvent.setup();
    renderComposer();

    await user.click(screen.getByRole("button", { name: "Dictate" }));
    const download = await screen.findByRole("button", { name: /Download/ });
    expect(commands()).not.toContain("dictation_start");

    await user.click(download);
    expect(invoke).toHaveBeenCalledWith("dictation_download", { id: "large-v3-turbo-q5_0" });
  });

  it("toggles recording with ⌘⇧D in any keyboard layout", async () => {
    shell({ installed: true, transcript: "hi" });
    renderComposer();

    fireEvent.keyDown(window, { key: "в", code: "KeyD", metaKey: true, shiftKey: true });
    fireEvent.keyUp(window, { key: "Meta", code: "MetaLeft" });
    expect(await screen.findByRole("status", { name: "Recording" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "в", code: "KeyD", metaKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("hi"));
  });

  it("stops on release after a push-to-talk hold", async () => {
    shell({ installed: true, transcript: "held" });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    renderComposer();

    fireEvent.keyDown(window, { key: "D", code: "KeyD", metaKey: true, shiftKey: true });
    await screen.findByRole("status", { name: "Recording" });
    now.mockReturnValue(1_500);
    fireEvent.keyUp(window, { key: "Meta", code: "MetaLeft" });

    await waitFor(() =>
      expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("held"),
    );
    now.mockRestore();
  });
});
