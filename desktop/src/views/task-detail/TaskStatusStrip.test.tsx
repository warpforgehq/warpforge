import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { daemon, type DaemonState } from "@/daemon";
import type { AgentAccountLimits, TaskInfo } from "@/protocol";

vi.mock("./GitWorkspaceControls", () => ({
  GitWorkspaceControls: ({ branch }: { branch: string | null }) => (
    <span data-testid="git-controls">{branch}</span>
  ),
}));

import { TaskStatusStrip } from "./TaskStatusStrip";

const task: TaskInfo = {
  id: "t1",
  project: "warpforge",
  prompt: "Fix it",
  agent: "claude",
  status: "running",
  tags: [],
  title: "Fix the footer",
  createdAt: 0,
  updatedAt: 0,
  filesChanged: 0,
  blockedReason: null,
};

const limits: AgentAccountLimits = {
  accountId: "claude:personal",
  agentId: "claude",
  label: "Personal",
  active: true,
  windows: [{ id: "five_hour", label: "Session", usedPercent: 44 }],
  exhausted: false,
  fetchedAt: Math.floor(Date.now() / 1000),
  source: "api",
};

function mockDaemon() {
  const state = {
    connection: "connected",
    connectionError: null,
    pendingAgentSetup: null,
    serviceLogs: {},
    portforwardLogs: {},
    sessionUpdates: {},
    agentLimits: [limits],
    agentSpend: null,
    snapshot: {
      projects: [],
      services: [],
      portforwards: [],
      tasks: [],
      terminals: [],
      accounts: [{ active: true, agentId: "claude", id: "claude:personal", label: "Personal" }],
    },
  } as DaemonState;
  vi.spyOn(daemon, "subscribe").mockReturnValue(() => {});
  vi.spyOn(daemon, "getState").mockReturnValue(state);
  vi.spyOn(daemon, "listAgentLimits").mockResolvedValue([limits]);
  vi.spyOn(daemon, "listAgentSpend").mockResolvedValue([]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TaskStatusStrip", () => {
  it("puts the task's account and quota where the workspace chip used to be", async () => {
    mockDaemon();
    const { container } = render(
      <TaskStatusStrip
        task={task}
        branch="main"
        repositoryOperation={null}
        onOpenCommit={() => {}}
        onOpenPush={() => {}}
      />,
    );

    const trigger = await screen.findByRole("button", { name: /account$/ });
    expect(trigger).toHaveTextContent("56% 5h");
    expect(container.firstElementChild?.firstElementChild).toContainElement(trigger);
    expect(container).not.toHaveTextContent("Local Workspace");
    expect(screen.getByTestId("git-controls")).toHaveTextContent("main");
  });

  it("reports a push in flight beside the git controls", async () => {
    mockDaemon();
    render(
      <TaskStatusStrip
        task={task}
        branch="main"
        repositoryOperation={{ kind: "push" }}
        onOpenCommit={() => {}}
        onOpenPush={() => {}}
      />,
    );

    expect(await screen.findByText("Pushing to remote…")).toBeInTheDocument();
  });
});
