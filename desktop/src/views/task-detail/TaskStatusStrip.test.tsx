import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { daemon, type DaemonState } from "@/daemon";
import type { AgentAccountLimits, TaskInfo } from "@/protocol";
import { useUi } from "@/store/ui";

vi.mock("./GitWorkspaceControls", () => ({
  GitWorkspaceControls: ({ branch }: { branch: string | null }) => (
    <span data-testid="git-controls">{branch}</span>
  ),
}));

import { TaskAccountMenu } from "@/components/TaskAccountMenu";

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
  it("holds the git controls and leaves the account to the workspace rail", async () => {
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

    expect(await screen.findByTestId("git-controls")).toHaveTextContent("main");
    expect(screen.queryByRole("button", { name: /account$/ })).toBeNull();
    expect(container).not.toHaveTextContent("Local Workspace");
  });

  it("draws the account's quota as rings in the rail variant", async () => {
    mockDaemon();
    const { container } = render(
      <TaskAccountMenu
        variant="ring"
        agentId={task.agent}
        agents={[]}
        accounts={daemon.getState().snapshot.accounts ?? []}
      />,
    );

    const trigger = await screen.findByRole("button", { name: /account$/ });
    expect(trigger.getAttribute("title")).toMatch(/56% left/);
    expect(container.querySelectorAll("circle[data-window]").length).toBeGreaterThan(0);
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

  it("names the advisor and opens its conversation", async () => {
    mockDaemon();
    useUi.setState({ openTaskId: "t1" });
    render(
      <TaskStatusStrip
        task={{
          ...task,
          advisor: {
            agent: "codex",
            consultations: 2,
            cost: { amount: 0.5, currency: "USD" },
            model: "gpt-5",
            taskId: "t_adv",
          },
        }}
        branch="main"
        repositoryOperation={null}
        onOpenCommit={() => {}}
        onOpenPush={() => {}}
      />,
    );

    const advisor = screen.getByRole("button", {
      name: "Open advisor conversation (Codex / gpt-5)",
    });
    expect(advisor).toHaveTextContent("Advisor · Codex / gpt-5");
    expect(advisor.title).toContain("Consulted 2 times · $0.50");
    await userEvent.click(advisor);
    expect(useUi.getState().openTaskId).toBe("t_adv");
  });
});
