import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
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
let sessionUpdates: Record<string, unknown[]> = {};
vi.mock("@/daemon", async () => {
  const actual = await vi.importActual<typeof import("@/daemon")>("@/daemon");
  return {
    DaemonRpcError: actual.DaemonRpcError,
    daemon: {
      getState: () => ({ sessionUpdates, snapshot: { tasks: [] } }),
      request: (...args: unknown[]) => request(...(args as [string, unknown])),
      subscribeEvents: (cb: (event: unknown) => void) => {
        emit = cb;
        return () => {};
      },
    },
  };
});

import { DaemonRpcError } from "@/daemon";
import { useUi } from "@/store/ui";

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
