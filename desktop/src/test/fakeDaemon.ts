import { vi } from "vitest";

import type { DaemonEvent } from "../protocol";

/**
 * A stand-in for the daemon client: `request` is a mock, events are pushed with
 * `emitDaemonEvent`. Use as `vi.mock("@/daemon", () => import("@/test/fakeDaemon"))`.
 */
export const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>();

const eventListeners = new Set<(event: DaemonEvent) => void>();
const stateListeners = new Set<() => void>();
let connection: "connected" | "disconnected" = "connected";

export function emitDaemonEvent(event: DaemonEvent) {
  for (const listener of eventListeners) listener(event);
}

export function setDaemonConnection(next: "connected" | "disconnected") {
  connection = next;
  for (const listener of stateListeners) listener();
}

export const daemon = {
  getState: () => ({ connection }),
  request,
  subscribe: (fn: () => void) => {
    stateListeners.add(fn);
    return () => stateListeners.delete(fn);
  },
  subscribeEvents: (fn: (event: DaemonEvent) => void) => {
    eventListeners.add(fn);
    return () => eventListeners.delete(fn);
  },
};
