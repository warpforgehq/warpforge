import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DaemonEvent, PeerControls, PeerMessage } from "@/protocol";

const daemonMock = vi.hoisted(() => {
  const listeners = new Set<(event: DaemonEvent) => void>();
  let resolveFeed: (records: PeerMessage[]) => void = () => {};
  return {
    emit: (event: DaemonEvent) => listeners.forEach((listener) => listener(event)),
    resolve: (records: PeerMessage[]) => resolveFeed(records),
    daemon: {
      getState: () => ({ connection: "connected" }),
      peerAlerts: vi.fn<() => Promise<PeerMessage[]>>(),
      peerControls: vi.fn<() => Promise<PeerControls>>(async () => ({
        mutedTasks: [],
        pausedProjects: [],
      })),
      peerFeed: vi.fn<() => Promise<PeerMessage[]>>(
        () =>
          new Promise((resolve) => {
            resolveFeed = resolve;
          }),
      ),
      subscribe: () => () => {},
      subscribeEvents: (listener: (event: DaemonEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
});
vi.mock("@/daemon", () => ({ daemon: daemonMock.daemon }));

import { usePeersStore } from "@/store/peers";
import { useUi } from "@/store/ui";

import { usePeerFeedSync } from "./usePeerFeed";

function record(id: number, overrides: Partial<PeerMessage> = {}): PeerMessage {
  return {
    createdAt: 100 + id,
    fromTask: "t_a",
    id,
    project: "demo",
    status: "queued",
    text: `message ${id}`,
    toTask: "t_b",
    ...overrides,
  };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("usePeerFeedSync", () => {
  beforeEach(() => {
    usePeersStore.setState({ loaded: false, records: {} });
    useUi.setState({ teamSeenAt: 0 });
    daemonMock.daemon.peerAlerts.mockResolvedValue([]);
  });

  it("keeps updates that arrive while the page is in flight", async () => {
    renderHook(() => usePeerFeedSync());
    act(() => {
      daemonMock.emit({ data: record(1, { status: "delivered" }), event: "peer.messageUpdated" });
      daemonMock.emit({ data: record(9), event: "peer.messageUpdated" });
    });
    daemonMock.resolve([record(1, { status: "held" }), record(2)]);
    await settle();

    const { records } = usePeersStore.getState();
    expect(records[1]?.status).toBe("delivered");
    expect(records[9]).toBeTruthy();
    expect(records[2]).toBeTruthy();
  });

  it("adds live alerts older than the page and seeds the first-run seen time", async () => {
    daemonMock.daemon.peerAlerts.mockResolvedValue([record(1, { alert: true, status: "refused" })]);
    renderHook(() => usePeerFeedSync());
    daemonMock.resolve([record(300), record(301)]);
    await settle();

    expect(usePeersStore.getState().records[1]?.alert).toBe(true);
    expect(useUi.getState().teamSeenAt).toBe(401);
  });

  it("leaves a seen time the user already has", async () => {
    useUi.setState({ teamSeenAt: 150 });
    renderHook(() => usePeerFeedSync());
    daemonMock.resolve([record(300)]);
    await settle();
    expect(useUi.getState().teamSeenAt).toBe(150);
  });
});
