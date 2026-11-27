import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { daemon } from "../daemon";
import type { AgentConfig, ConfigOption, Snapshot } from "../protocol";
import { useUi } from "../store/ui";
import NewTaskDialog from "./NewTaskDialog";

const model = (values: string[]): ConfigOption => ({
  category: "model",
  currentValue: values[0],
  id: "model",
  name: "Model",
  options: values.map((value) => ({ name: value, value })),
});

const claude: AgentConfig = {
  acpCommand: "claude",
  displayName: "Claude",
  enabled: true,
  id: "claude",
  models: [model(["sonnet"])],
};

const codex: AgentConfig = {
  acpCommand: "codex",
  displayName: "Codex",
  enabled: true,
  id: "codex",
  models: [model(["gpt-5"])],
};

const snapshot: Snapshot = {
  agents: [claude, codex],
  portforwards: [],
  projects: [
    {
      declaredServices: [],
      name: "warpforge",
      path: "/workspace/warpforge",
      portRange: [4000, 4099],
    },
  ],
  services: [],
  tasks: [],
  terminals: [],
};

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

function createParams(): Record<string, unknown> {
  const call = vi.mocked(daemon.request).mock.calls.find(([method]) => method === "task.create");
  return (call?.[1] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  localStorage.clear();
  useUi.setState({ autoNameTasks: false, newTaskWorktree: false, openTaskId: null });
  vi.spyOn(daemon, "request").mockImplementation(async (method) =>
    method === "task.create" ? { taskId: "created-task" } : {},
  );
  vi.spyOn(daemon, "workflowList").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  useUi.setState({ openTaskId: null });
});

describe("NewTaskDialog advisor", () => {
  it("sends no advisor unless one was turned on", async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(screen.getByRole("button", { name: "Advisor" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await user.type(screen.getByPlaceholderText("What should the agent do?"), "Ship it");
    await user.click(screen.getByRole("button", { name: "Start task" }));

    await waitFor(() => expect(createParams().prompt).toBe("Ship it"));
    expect(createParams().advisor).toBeUndefined();
  });

  it("defaults to another harness and sends the picked model", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Advisor" }));
    expect(screen.getByRole("button", { name: "Advisor harness" })).toHaveTextContent("Codex");
    await user.click(screen.getByRole("button", { name: "Advisor model: Default" }));
    await user.click(screen.getByRole("button", { name: "gpt-5" }));
    await user.type(screen.getByPlaceholderText("What should the agent do?"), "Ship it");
    await user.click(screen.getByRole("button", { name: "Start task" }));

    await waitFor(() => expect(createParams().advisor).toEqual({ agent: "codex", model: "gpt-5" }));
  });

  it("leaves the advisor out of an orchestrator run", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Advisor" }));
    await user.click(screen.getByRole("radio", { name: "Orchestrator" }));
    expect(screen.getByRole("button", { name: "Advisor" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Advisor harness" })).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("What should the orchestrator coordinate?"), "Go");
    await user.click(screen.getByRole("button", { name: "Start orchestrator" }));

    await waitFor(() => expect(createParams().prompt).toBe("Go"));
    expect(createParams().advisor).toBeUndefined();
  });
});
