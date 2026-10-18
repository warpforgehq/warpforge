import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { daemon } from "../daemon";
import type { AgentConfig, Snapshot } from "../protocol";
import { useSmithsStore } from "../store/smiths";
import { useUi } from "../store/ui";
import { smithFixture } from "../test/smiths";
import NewTaskDialog from "./NewTaskDialog";

const claude: AgentConfig = {
  acpCommand: "claude",
  displayName: "Claude",
  enabled: true,
  id: "claude",
  models: [],
};

const project = (name: string) => ({
  agentTemplates: {},
  declaredServices: [],
  name,
  path: `/workspace/${name}`,
  portRange: [4000, 4099] as [number, number],
});

const snapshot: Snapshot = {
  accounts: [{ active: true, agentId: "claude", id: "claude:work", label: "Work" }],
  agents: [claude],
  portforwards: [],
  projects: [project("warpforge"), project("lingoverse")],
  services: [],
  tasks: [],
  terminals: [],
};

const ada = smithFixture({
  accountId: "claude:work",
  allowedProjects: ["warpforge"],
  id: "sm_ada",
  model: "opus",
  name: "Ada",
});
const bo = smithFixture({ allowedProjects: ["lingoverse"], id: "sm_bo", name: "Bo" });

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <NewTaskDialog
        defaultProject="warpforge"
        onOpenChange={vi.fn<(open: boolean) => void>()}
        open
        snapshot={snapshot}
      />
    </QueryClientProvider>,
  );
}

function calls(method: string): Record<string, unknown>[] {
  return vi
    .mocked(daemon.request)
    .mock.calls.filter(([name]) => name === method)
    .map(([, params]) => params as Record<string, unknown>);
}

beforeEach(() => {
  localStorage.clear();
  useUi.setState({
    autoNameTasks: false,
    newTaskSmith: null,
    newTaskWorktree: false,
    openTaskId: null,
  });
  useSmithsStore.setState({ smiths: { [ada.id]: ada, [bo.id]: bo } });
  vi.spyOn(daemon, "request").mockImplementation(async (method) =>
    method === "smiths.startWork" || method === "task.create" ? { taskId: "t_new" } : {},
  );
  vi.spyOn(daemon, "workflowList").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  useSmithsStore.setState({ smiths: {} });
});

describe("NewTaskDialog with a Smith", () => {
  it("offers only the Smiths allowed in the selected project", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Harness" }));
    expect(screen.getByRole("menuitem", { name: /^Ada/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^Bo/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /^Ada/ })).toHaveTextContent("Claude Code · opus");
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Project" }));
    await user.click(screen.getByRole("menuitem", { name: "lingoverse" }));
    await user.click(screen.getByRole("button", { name: "Harness" }));
    expect(screen.getByRole("menuitem", { name: /^Bo/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^Ada/ })).toBeNull();
  });

  it("locks the Smith's model and account, hides the advisor, keeps the worktree", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Harness" }));
    await user.click(screen.getByRole("menuitem", { name: /^Ada/ }));

    expect(screen.getByRole("button", { name: "Harness" })).toHaveTextContent("Ada");
    const model = screen.getByRole("button", { name: "Model" });
    expect(model).toHaveAttribute("aria-disabled", "true");
    expect(model).toHaveTextContent("opus");
    expect(model).toHaveAttribute("title", "Set in Ada's settings");
    const account = screen.getByRole("button", { name: "Account" });
    expect(account).toHaveTextContent("Work");
    expect(account).toHaveAttribute("title", "Set in Ada's settings");
    expect(screen.queryByRole("button", { name: "Advisor" })).toBeNull();
    expect(screen.getByRole("button", { name: "Worktree" })).toBeTruthy();
  });

  it("starts the prompt as the Smith's work and opens it", async () => {
    const user = userEvent.setup();
    useUi.setState({ newTaskWorktree: true });
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Harness" }));
    await user.click(screen.getByRole("menuitem", { name: /^Ada/ }));
    await user.type(screen.getByPlaceholderText("What should Ada work on?"), "Fix the flaky test");
    await user.click(screen.getByRole("button", { name: "Start as Ada" }));

    await waitFor(() => expect(calls("smiths.startWork")).toHaveLength(1));
    expect(calls("smiths.startWork")[0]).toEqual({
      backlog_item_id: null,
      brief: "Fix the flaky test",
      id: "sm_ada",
      project: "warpforge",
      worktree: true,
    });
    expect(calls("task.create")).toHaveLength(0);
    expect(useUi.getState().openTaskId).toBe("t_new");
    expect(useUi.getState().newTaskSmith).toBe("sm_ada");
  });

  it("falls back to the agent when the remembered Smith is gone or not allowed", () => {
    useUi.setState({ newTaskSmith: "sm_gone" });
    renderDialog();
    expect(screen.getByRole("button", { name: "Harness" })).toHaveTextContent("Claude");
  });

  it("remembers a Smith only where it is allowed", async () => {
    const user = userEvent.setup();
    useUi.setState({ newTaskSmith: "sm_ada" });
    renderDialog();
    expect(screen.getByRole("button", { name: "Harness" })).toHaveTextContent("Ada");

    await user.click(screen.getByRole("button", { name: "Project" }));
    await user.click(screen.getByRole("menuitem", { name: "lingoverse" }));
    expect(screen.getByRole("button", { name: "Harness" })).toHaveTextContent("Claude");
  });

  it("forgets the Smith once an agent is picked", async () => {
    const user = userEvent.setup();
    useUi.setState({ newTaskSmith: "sm_ada" });
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Harness" }));
    await user.click(screen.getByRole("menuitem", { name: "Claude" }));
    expect(screen.getByRole("button", { name: "Harness" })).toHaveTextContent("Claude");
    expect(useUi.getState().newTaskSmith).toBeNull();
  });

  it("starts a Smith as an orchestrator lead from Orchestrator mode", async () => {
    const user = userEvent.setup();
    useUi.setState({ newTaskSmith: "sm_ada", newTaskWorktree: true });
    renderDialog();

    await user.click(screen.getByRole("radio", { name: "Orchestrator" }));
    expect(screen.getByRole("button", { name: "Harness" })).toHaveTextContent("Ada");
    expect(screen.getByRole("button", { name: "Model" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Ada leads")).toBeTruthy();
    await user.type(
      screen.getByPlaceholderText("What should Ada coordinate?"),
      "Split the migration",
    );
    await user.click(screen.getByRole("button", { name: "Start Ada as orchestrator" }));

    await waitFor(() => expect(calls("smiths.startWork")).toHaveLength(1));
    expect(calls("smiths.startWork")[0]).toEqual({
      backlog_item_id: null,
      brief: "Split the migration",
      id: "sm_ada",
      orchestrator: true,
      project: "warpforge",
      worktree: false,
    });
    expect(calls("task.create")).toHaveLength(0);
    expect(useUi.getState().openTaskId).toBe("t_new");
  });

  it("offers no Smith in Factory mode", async () => {
    const user = userEvent.setup();
    useUi.setState({ newTaskSmith: "sm_ada" });
    vi.mocked(daemon.workflowList).mockResolvedValue([
      {
        id: "review-loop",
        maxRounds: 3,
        name: "Review loop",
        source: "builtin",
        stages: ["implement", "review", "fix"],
        valid: true,
      },
    ]);
    renderDialog();

    const factory = screen.getByRole("radio", { name: "Factory" });
    await waitFor(() => expect(factory).not.toBeDisabled());
    await user.click(factory);
    expect(screen.getByRole("button", { name: "Harness" })).toHaveTextContent("Claude");
    await user.click(screen.getByRole("button", { name: "Harness" }));
    expect(screen.queryByRole("menuitem", { name: /^Ada/ })).toBeNull();
  });
});
