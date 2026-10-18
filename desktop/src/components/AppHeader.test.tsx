import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { daemon, type DaemonState } from "@/daemon";
import type { AccountInfo, TaskInfo } from "@/protocol";
import { useSmithsStore } from "@/store/smiths";
import { useUi } from "@/store/ui";
import { smithFixture } from "@/test/smiths";

import AppHeader from "./AppHeader";

const task = (overrides: Partial<TaskInfo> = {}): TaskInfo => ({
  id: "t1",
  project: "warpforge",
  prompt: "Fix it",
  agent: "claude",
  status: "running",
  tags: [],
  title: "Fix the header",
  createdAt: 0,
  updatedAt: 0,
  filesChanged: 0,
  blockedReason: null,
  ...overrides,
});

const accounts: AccountInfo[] = [
  { active: true, agentId: "claude", id: "claude:personal", label: "Personal" },
];

function mockDaemon() {
  const state = {
    connection: "connected",
    connectionError: null,
    pendingAgentSetup: null,
    serviceLogs: {},
    portforwardLogs: {},
    sessionUpdates: {},
    agentLimits: null,
    agentSpend: null,
    snapshot: { projects: [], services: [], portforwards: [], tasks: [], terminals: [], accounts },
  } as DaemonState;
  vi.spyOn(daemon, "subscribe").mockReturnValue(() => {});
  vi.spyOn(daemon, "getState").mockReturnValue(state);
}

function renderHeader(
  openTask: TaskInfo | null,
  view: "control" | "project" | "inbox" = "project",
) {
  return render(
    <AppHeader view={view} openTask={openTask} onAddProject={() => {}} onCloseTask={() => {}} />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppHeader without a task", () => {
  it("shows no account control on a view with no agent in focus", () => {
    mockDaemon();
    renderHeader(null, "control");

    expect(screen.queryByRole("button", { name: /account$/ })).toBeNull();
    expect(screen.queryByText("Personal")).toBeNull();
  });
});

describe("AppHeader with an open task", () => {
  it("leaves the task's account control to the task footer", () => {
    mockDaemon();
    renderHeader(task());

    expect(screen.queryByRole("button", { name: /account$/ })).toBeNull();
  });

  it("says nothing about the workspace when the task runs in the project checkout", () => {
    mockDaemon();
    renderHeader(task());

    expect(screen.queryByText(/Local Workspace/)).toBeNull();
  });

  it("names a worktree and shows its path on hover", () => {
    mockDaemon();
    renderHeader(task({ worktree: "/tmp/wt/fix-header" }));

    expect(screen.getByTitle("/tmp/wt/fix-header")).toHaveTextContent("Git Worktree");
  });

  it("names the Smith a task runs as before its title and opens its page", async () => {
    mockDaemon();
    useSmithsStore.getState().upsert(smithFixture());
    renderHeader(task({ smithId: "sm_1" }));

    const byline = screen.getByRole("button", { name: /Ada/ });
    expect(byline).toHaveTextContent("Ada·");
    await userEvent.click(byline);
    expect(useUi.getState().teamSelection).toEqual({ id: "sm_1", kind: "teammate" });
    expect(useUi.getState().view).toBe("team");
  });

  it("shows no byline for a task no Smith runs", () => {
    mockDaemon();
    renderHeader(task());

    expect(screen.queryByTitle(/^Open /)).toBeNull();
  });
});
