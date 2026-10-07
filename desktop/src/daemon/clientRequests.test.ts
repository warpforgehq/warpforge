import { describe, expect, it, vi } from "vitest";

import type { ClientRequestBody, DaemonEvent } from "../protocol";
import { capabilityOf, serveClientRequests, type ClientRequestChannel } from "./clientRequests";
import type { ConnectionState } from "./types";

function fakeChannel(connection: ConnectionState = "connected") {
  const state = { connection };
  const stateListeners = new Set<() => void>();
  const eventListeners = new Set<(event: DaemonEvent) => void>();
  const request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>(() =>
    Promise.resolve({}),
  );
  const channel: ClientRequestChannel = {
    request,
    subscribe: (fn) => {
      stateListeners.add(fn);
      return () => stateListeners.delete(fn);
    },
    subscribeEvents: (fn) => {
      eventListeners.add(fn);
      return () => eventListeners.delete(fn);
    },
    getState: () => state,
  };
  return {
    channel,
    request,
    setConnection(next: ConnectionState) {
      state.connection = next;
      for (const fn of stateListeners) fn();
    },
    emit(event: DaemonEvent) {
      for (const fn of eventListeners) fn(event);
    },
  };
}

const body: ClientRequestBody = {
  kind: "browser",
  project: "demo",
  action: { action: "snapshot" },
  allowed_origins: [],
};

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("serveClientRequests", () => {
  it("registers now and again after every reconnect", () => {
    const fake = fakeChannel();
    serveClientRequests(fake.channel, "browser", () => Promise.resolve(null));
    fake.setConnection("disconnected");
    fake.setConnection("connected");
    const registrations = fake.request.mock.calls.filter(
      ([method]) => method === "client.register",
    );
    expect(registrations).toEqual([
      ["client.register", { capabilities: ["browser"] }],
      ["client.register", { capabilities: ["browser"] }],
    ]);
  });

  it("replies with the handler's result or its error message", async () => {
    const fake = fakeChannel();
    const handler = vi
      .fn<(b: ClientRequestBody) => Promise<unknown>>()
      .mockResolvedValueOnce({ tree: "x" })
      .mockRejectedValueOnce("no such browser tab");
    serveClientRequests(fake.channel, "browser", handler);

    fake.emit({ event: "client.request", data: { request_id: "r1", timeout_ms: 1000, body } });
    fake.emit({ event: "client.request", data: { request_id: "r2", timeout_ms: 1000, body } });
    await flush();

    expect(fake.request).toHaveBeenCalledWith("client.reply", {
      request_id: "r1",
      result: { tree: "x" },
    });
    expect(fake.request).toHaveBeenCalledWith("client.reply", {
      request_id: "r2",
      error: "no such browser tab",
    });
  });

  it("a cancelled request is aborted and not answered", async () => {
    const fake = fakeChannel();
    let aborted = false;
    let finish: () => void = () => {};
    serveClientRequests(fake.channel, "browser", (_body, signal) => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      return new Promise((resolve) => {
        finish = () => resolve("late");
      });
    });

    fake.emit({ event: "client.request", data: { request_id: "r1", timeout_ms: 1000, body } });
    fake.emit({ event: "client.requestCancelled", data: { request_id: "r1" } });
    finish();
    await flush();

    expect(aborted).toBe(true);
    expect(fake.request.mock.calls.some(([method]) => method === "client.reply")).toBe(false);
  });

  it("waits for the connection before registering", () => {
    const fake = fakeChannel("connecting");
    serveClientRequests(fake.channel, "browser", () => Promise.resolve(null));
    expect(fake.request).not.toHaveBeenCalled();
    fake.setConnection("connected");
    expect(fake.request).toHaveBeenCalledWith("client.register", { capabilities: ["browser"] });
  });
});

describe("capabilityOf", () => {
  it("sends HTML previews to the app that owns the browser", () => {
    const preview: ClientRequestBody = { kind: "html_preview", html: "<p>x</p>", width: 720 };
    expect(capabilityOf(preview)).toBe("browser");
    const browse: ClientRequestBody = {
      kind: "browser",
      project: "p",
      action: { action: "console" },
      allowed_origins: [],
    };
    expect(capabilityOf(browse)).toBe("browser");
  });
});
