import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentConfig, PullRequestDiff, PullRequestSummary, TaskInfo } from "@/protocol";

const { pullDiff, request, taskCreate } = vi.hoisted(() => ({
  pullDiff: vi.fn<() => Promise<PullRequestDiff>>(),
  request: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(),
  taskCreate: vi.fn<(params: Record<string, unknown>) => Promise<string>>(),
}));

vi.mock("@/daemon", () => ({
  daemon: {
    getState: () => ({ sessionUpdates: {}, snapshot: { agents: [], tasks: [] } }),
    pullDiff,
    request,
    subscribe: () => () => {},
    taskCreate,
  },
}));

// The transcript pulls in the whole chat stack; this pane's job is to pick the
// right task and hand it over.
vi.mock("@/components/ChatTranscript", () => ({
  ChatTranscript: ({ task }: { task: TaskInfo }) => (
    <div data-testid="transcript" data-task-id={task.id} />
  ),
}));

import { useUi } from "@/store/ui";

import { PullAssistant } from "./PullAssistant";

const pr: PullRequestSummary = {
  project: "warpforge",
  repo: "acme/widgets",
  number: 7,
  title: "Add widget",
  url: "https://github.test/pull/7",
  state: "open",
  draft: false,
  labels: [],
  assignees: [],
  baseRefName: "main",
  headRefName: "widget",
  createdAt: 0,
  updatedAt: 0,
};

const diff: PullRequestDiff = {
  additions: 1,
  deletions: 0,
  files: [{ path: "src/a.ts", additions: 1, deletions: 0 }],
  patch: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n+new\n",
  truncated: false,
};

function shadowTask(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id: "t-pr",
    project: "warpforge",
    prompt: "Explain this pull request",
    agent: "claude",
    status: "waiting",
    tags: ["pr-review", "pr:acme/widgets#7"],
    title: "Explain this pull request",
    createdAt: 1,
    updatedAt: 1,
    filesChanged: 0,
    blockedReason: null,
    origin: "pr-review",
    ...overrides,
  };
}

const agents: AgentConfig[] = [
  {
    id: "claude",
    displayName: "Claude Code",
    acpCommand: "claude",
    enabled: true,
    models: [
      {
        id: "model",
        name: "Model",
        category: "model",
        currentValue: "sonnet",
        options: [
          { value: "sonnet", name: "Sonnet 5" },
          { value: "opus", name: "Opus 5" },
        ],
      },
    ],
  },
  {
    id: "opencode",
    displayName: "opencode",
    acpCommand: "opencode",
    enabled: true,
    models: [],
  },
];

function renderPane(tasks: TaskInfo[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PullAssistant pr={pr} details={null} tasks={tasks} agents={agents} />
    </QueryClientProvider>,
  );
}

describe("PullAssistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pullDiff.mockResolvedValue(diff);
    taskCreate.mockResolvedValue("t-pr");
    request.mockResolvedValue({});
  });

  it("starts one conversation, tagged to the pull request and hidden from the board", async () => {
    const user = userEvent.setup();
    renderPane();

    await user.click(screen.getByRole("button", { name: "Explain" }));
    await waitFor(() => expect(taskCreate).toHaveBeenCalledTimes(1));
    const params = taskCreate.mock.calls[0][0];
    expect(params.origin).toBe("pr-review");
    expect(params.tags).toEqual(["pr-review", "pr:acme/widgets#7"]);
    expect(params.worktree).toBe(false);
    expect(params.includeRuntimeContext).toBe(false);
    expect(String(params.prompt)).toContain("acme/widgets#7");
  });

  it("reopens the existing conversation instead of spawning a second one", async () => {
    const user = userEvent.setup();
    renderPane([shadowTask()]);

    expect(screen.getByTestId("transcript")).toHaveAttribute("data-task-id", "t-pr");
    // The second entry button seeds the same thread: a prompt, not a task.
    await user.click(screen.getByRole("button", { name: "Review" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("session.prompt", expect.anything()));
    expect(taskCreate).not.toHaveBeenCalled();
    expect(String((request.mock.calls[0][1] as { text: string }).text)).toContain("Findings only");
  });

  it("does not adopt another pull request's conversation", () => {
    renderPane([shadowTask({ id: "t-other", tags: ["pr-review", "pr:acme/widgets#9"] })]);
    expect(screen.queryByTestId("transcript")).not.toBeInTheDocument();
  });

  it("says what is missing when no agent is configured", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PullAssistant pr={pr} details={null} tasks={[]} agents={[]} />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/Add an agent in Settings/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explain" })).toBeDisabled();
  });

  it("asks the picked model, and remembers the pick per harness", async () => {
    const user = userEvent.setup();
    useUi.setState({ prAssistantAgentId: null, prAssistantModelByAgent: {} });
    renderPane();

    // Defaults to the harness's own current value, not to nothing.
    await user.click(screen.getByRole("button", { name: /Sonnet 5/ }));
    await user.click(screen.getByRole("menuitem", { name: /Opus 5/ }));
    await user.click(screen.getByRole("button", { name: "Explain" }));

    await waitFor(() => expect(taskCreate).toHaveBeenCalledTimes(1));
    expect(taskCreate.mock.calls[0][0].defaultModel).toBe("opus");
    expect(useUi.getState().prAssistantModelByAgent).toEqual({ claude: "opus" });
  });

  it("lets the harness be chosen instead of taking the first one", async () => {
    const user = userEvent.setup();
    useUi.setState({ prAssistantAgentId: null, prAssistantModelByAgent: {} });
    renderPane();

    await user.click(screen.getByRole("button", { name: /Claude Code/ }));
    await user.click(screen.getByRole("menuitem", { name: /opencode/ }));
    await user.click(screen.getByRole("button", { name: "Explain" }));

    await waitFor(() => expect(taskCreate).toHaveBeenCalledTimes(1));
    expect(taskCreate.mock.calls[0][0].agent).toBe("opencode");
  });

  it("keeps going when the diff cannot be fetched", async () => {
    const user = userEvent.setup();
    pullDiff.mockRejectedValue(new Error("no token"));
    renderPane();

    await user.click(screen.getByRole("button", { name: "Explain" }));
    await waitFor(() => expect(taskCreate).toHaveBeenCalledTimes(1));
    // The prompt still names the pull request; the agent can read the repo.
    expect(String(taskCreate.mock.calls[0][0].prompt)).toContain("acme/widgets#7");
  });
});
