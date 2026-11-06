import { describe, expect, it } from "vitest";

import type { PortForwardInfo, ServiceInfo, TerminalInfo } from "@/protocol";

import { liveItemLabel, liveItems, liveState, liveTally, surfaceTally } from "./liveActivity";

const terminal = (id: string, project: string, taskId?: string | null): TerminalInfo => ({
  cols: 80,
  command: "/bin/zsh",
  id,
  project,
  rows: 24,
  startedAt: 1,
  taskId,
});

const service = (name: string, status: ServiceInfo["status"], project = "demo"): ServiceInfo => ({
  allocatedPort: 4000,
  command: "bun dev",
  logSeq: 0,
  name,
  originalPort: 3000,
  project,
  status,
});

const forward = (name: string, status: PortForwardInfo["status"]): PortForwardInfo => ({
  localPort: 5432,
  logSeq: 0,
  name,
  namespace: "default",
  pod: "db-0",
  project: "demo",
  remotePort: 5432,
  status,
});

const snapshot = {
  portforwards: [forward("db", "restarting"), forward("cache", "stopped"), forward("q", "failed")],
  services: [
    service("web", "running"),
    service("api", "starting"),
    service("worker", "stopped"),
    service("cron", "failed"),
    service("other", "running", "elsewhere"),
  ],
  terminals: [
    terminal("t-a", "demo", "task-1"),
    terminal("t-b", "demo", "task-2"),
    terminal("t-c", "demo", null),
    terminal("t-d", "elsewhere", "task-1"),
  ],
};

describe("liveItems", () => {
  it("gives a task its own terminals and its project's live services and forwards", () => {
    expect(liveItems(snapshot, { project: "demo", taskId: "task-1" })).toEqual([
      { kind: "terminal", name: "zsh", scope: "task", state: "running" },
      { kind: "service", name: "web", scope: "project", state: "running" },
      { kind: "service", name: "api", scope: "project", state: "running" },
      { kind: "service", name: "cron", scope: "project", state: "failed" },
      { kind: "portforward", name: "db", scope: "project", state: "running" },
      { kind: "portforward", name: "q", scope: "project", state: "failed" },
    ]);
  });

  it("gives a project only the terminals no task owns", () => {
    const terminals = liveItems(snapshot, { project: "demo" }).filter(
      (item) => item.kind === "terminal",
    );
    expect(terminals).toEqual([
      { kind: "terminal", name: "zsh", scope: "project", state: "running" },
    ]);
  });

  it("is empty when nothing runs", () => {
    expect(
      liveItems(
        {
          portforwards: [forward("db", "stopped")],
          services: [service("web", "stopped")],
          terminals: [],
        },
        { project: "demo", taskId: "task-1" },
      ),
    ).toEqual([]);
  });
});

describe("tallies", () => {
  const items = liveItems(snapshot, { project: "demo", taskId: "task-1" });

  it("lets failed win over running", () => {
    expect(liveTally(items)).toEqual({ failed: 2, running: 4 });
    expect(liveState(liveTally(items))).toBe("failed");
    expect(liveState({ failed: 0, running: 1 })).toBe("running");
    expect(liveState({ failed: 0, running: 0 })).toBeNull();
  });

  it("counts per surface", () => {
    expect(surfaceTally(items, "terminal")).toEqual({ failed: 0, running: 1 });
    expect(surfaceTally(items, "runtime")).toEqual({ failed: 2, running: 3 });
    expect(surfaceTally(items, "diff")).toBeUndefined();
  });

  it("labels an item by kind, name and state", () => {
    expect(liveItemLabel(items[3])).toBe("Service cron · failed");
  });
});
