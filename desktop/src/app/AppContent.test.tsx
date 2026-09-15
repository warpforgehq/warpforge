import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Snapshot } from "@/protocol";

const { daemonState } = vi.hoisted(() => ({
  daemonState: {
    connection: "connected",
    connectionError: null,
    snapshot: { agents: [] as unknown[], projects: [] as unknown[], tasks: [] as unknown[] },
  },
}));

vi.mock("@/daemon", () => ({
  daemon: {
    // One stable object: a fresh one per `getState` makes useSyncExternalStore
    // re-render forever.
    getState: () => daemonState,
    subscribe: () => () => {},
  },
}));

const { prefetchRouteChunks } = vi.hoisted(() => ({ prefetchRouteChunks: vi.fn<() => void>() }));

vi.mock("./routePrefetch", () => {
  const stub = () => Promise.resolve({ default: () => null });
  return {
    loadAutomations: stub,
    loadInboxView: stub,
    loadMissionControl: stub,
    loadProjects: stub,
    loadTaskDetail: stub,
    prefetchRouteChunks,
  };
});

import { AppContent, type AppContentProps } from "./AppContent";

function props(overrides: Partial<AppContentProps> = {}): AppContentProps {
  return {
    snapshot: { agents: [], projects: [], tasks: [] } as unknown as Snapshot,
    connection: "connected",
    connectionError: null,
    view: "control",
    openTask: null,
    newTaskOpen: false,
    newTaskProject: null,
    newTaskPrompt: undefined,
    newTaskBacklogItemId: null,
    onNewTaskOpenChange: () => {},
    onOpenTask: () => {},
    onCloseTask: () => {},
    onAddProject: () => {},
    onNewTask: () => {},
    onOpenPush: () => {},
    projectNames: [],
    showPersistent: true,
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("AppContent route prefetch", () => {
  it("loads the route chunks once the daemon is connected", async () => {
    render(<AppContent {...props()} />);

    await waitFor(() => expect(prefetchRouteChunks).toHaveBeenCalledTimes(1));
  });

  it("waits for the connection before loading chunks", async () => {
    render(<AppContent {...props({ connection: "connecting" })} />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(prefetchRouteChunks).not.toHaveBeenCalled();
  });
});
