import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ isFocused: async () => false }),
}));

const request = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => null);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...(args as [])),
}));

let notifyAction: ((event: { payload: unknown }) => void) | null = null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn<(name: string, cb: (event: { payload: unknown }) => void) => Promise<() => void>>(
    async (_name, cb) => {
      notifyAction = cb;
      return () => {};
    },
  ),
}));

let emit: ((event: unknown) => void) | null = null;
let tasks: TaskInfo[] = [];
let sessionUpdates: Record<string, unknown[]> = {};
vi.mock("@/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/daemon")>("@/daemon");
  return {
    DaemonRpcError: actual.DaemonRpcError,
    daemon: {
      getState: () => ({ sessionUpdates, snapshot: { tasks } }),
      request: (...args: unknown[]) => request(...(args as [string, unknown])),
      subscribeEvents: (cb: (event: unknown) => void) => {
        emit = cb;
        return () => {};
      },
    },
  };
});

import { DaemonRpcError } from "@/daemon";
import type { DaemonEvent, TaskInfo } from "@/protocol";
import { useUi } from "@/store/ui";
import { notificationDefaults } from "@/store/ui/devicePreferences";
import NotificationsPage from "@/views/settings/pages/Notifications";

import { useDaemonEvents } from "./useDaemonEvents";

function resolvedEvent() {
  return {
    event: "session.update",
    data: {
      task_id: "t_1",
      update: { kind: "permission_resolved", outcome: "allow", request_id: "req-9" },
    },
  };
}

describe("useDaemonEvents native notification lifecycle", () => {
  beforeEach(() => {
    invoke.mockClear();
    request.mockClear();
    notifyAction = null;
    sessionUpdates = {};
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    renderHook(() => useDaemonEvents());
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("withdraws the delivered notification when the request resolves", async () => {
    expect(emit).not.toBeNull();
    emit?.(resolvedEvent());

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("withdraw_attention", {
        payload: { kind: "permission", request_id: "req-9", task_id: "t_1" },
      }),
    );
  });

  it("ignores a banner answer that lost the race, with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    request.mockRejectedValueOnce(
      new DaemonRpcError("permission_already_resolved", 'already resolved as "allow"'),
    );

    await vi.waitFor(() => expect(notifyAction).not.toBeNull());
    notifyAction?.({
      payload: { action: "reject", kind: "permission", request_id: "req-9", task_id: "t_1" },
    });

    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        "native notification answered a request that was already resolved",
        expect.stringContaining("already resolved"),
      ),
    );
    // A stale banner is withdrawn rather than left tappable.
    expect(invoke).toHaveBeenCalledWith("withdraw_attention", {
      payload: { kind: "permission", request_id: "req-9", task_id: "t_1" },
    });
    warn.mockRestore();
  });

  it("opens the task when the request offers no one-shot approval", async () => {
    sessionUpdates = {
      t_1: [
        {
          kind: "permission_request",
          options: ["allow_always", "deny"],
          request_id: "req-9",
          title: "Edit the config",
        },
      ],
    };
    const revealTask = vi.spyOn(useUi.getState(), "revealTask").mockImplementation(() => {});

    await vi.waitFor(() => expect(notifyAction).not.toBeNull());
    notifyAction?.({
      payload: { action: "approve", kind: "permission", request_id: "req-9", task_id: "t_1" },
    });

    expect(revealTask).toHaveBeenCalledWith("t_1");
    expect(request).not.toHaveBeenCalled();
    revealTask.mockRestore();
  });
});

const task: TaskInfo = {
  id: "t_1",
  agent: "codex",
  project: "warpforge",
  status: "running",
  prompt: "Improve search",
  title: "",
  tags: [],
  filesChanged: 0,
  createdAt: 1,
  updatedAt: 1,
  blockedReason: null,
};

const completion: DaemonEvent = {
  event: "session.update",
  data: { task_id: task.id, update: { kind: "turn_ended", stop_reason: "end_turn" } },
};

describe("notification settings", () => {
  beforeEach(() => {
    invoke.mockClear();
    tasks = [task];
    useUi.setState({ notifications: notificationDefaults });
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    renderHook(() => useDaemonEvents());
    render(<NotificationsPage />);
  });

  afterEach(() => {
    tasks = [];
    act(() => useUi.setState({ notifications: notificationDefaults }));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the task-finished toast only when enabled", async () => {
    const custom = vi.spyOn(toast, "custom");
    emit?.(completion);
    expect(custom).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("switch", { name: "Task-finished toast" }));
    emit?.(completion);
    expect(custom).toHaveBeenCalledTimes(1);
    expect(custom).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ id: "finished:t_1" }),
    );
  });

  it("gates the needs-you toast while preserving the native attention banner", async () => {
    const custom = vi.spyOn(toast, "custom");
    const blocked = { event: "task.updated", data: { ...task, status: "blocked" } };
    emit?.(blocked);
    expect(custom).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("switch", { name: "Needs-you toast" }));
    custom.mockClear();
    invoke.mockClear();
    emit?.(blocked);
    expect(custom).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "notify_attention",
        expect.objectContaining({
          payload: expect.objectContaining({ kind: "review" }),
        }),
      ),
    );
  });

  it("gates each new permission toast", async () => {
    const custom = vi.spyOn(toast, "custom");
    const permission = (request_id: string) => ({
      event: "session.update",
      data: {
        task_id: task.id,
        update: { kind: "permission_request", request_id, options: ["allow"], title: "Run tests" },
      },
    });
    emit?.(permission("req-1"));
    expect(custom).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("switch", { name: "Permission toast" }));
    custom.mockClear();
    emit?.(permission("req-2"));
    expect(custom).not.toHaveBeenCalled();
  });

  it("sends the native finish notification independently from the in-app toast", async () => {
    const custom = vi.spyOn(toast, "custom");
    emit?.(completion);
    await userEvent.click(
      screen.getByRole("switch", { name: "macOS notification on task finish" }),
    );
    expect(invoke).not.toHaveBeenCalled();

    emit?.(completion);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "notify_attention",
        expect.objectContaining({
          payload: expect.objectContaining({ kind: "finish", task_id: task.id }),
        }),
      ),
    );
    expect(custom).not.toHaveBeenCalled();
  });
});
