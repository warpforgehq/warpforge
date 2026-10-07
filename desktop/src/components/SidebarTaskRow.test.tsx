import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { daemon } from "@/daemon";
import { normalizeRunnerStatus } from "@/daemon/runner";
import { openExternalLink } from "@/lib/externalLinks";
import type { DaemonEvent, TaskInfo, TaskPullRequest } from "@/protocol";

import { SidebarTaskRow } from "./SidebarTaskRow";
import { TooltipProvider } from "./ui/tooltip";

vi.mock("@/lib/externalLinks", () => ({
  openExternalLink: vi.fn<(url: string) => Promise<void>>(),
}));

const base: TaskInfo = {
  agent: "codex",
  blockedReason: null,
  createdAt: 1,
  filesChanged: 0,
  id: "t1",
  parentTaskId: null,
  project: "demo",
  prompt: "Do the thing",
  status: "waiting",
  tags: [],
  title: "Do the thing",
  updatedAt: 1,
};

function renderRow(task: TaskInfo, childCount = 0) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider delayDuration={0} skipDelayDuration={0}>
        <SidebarTaskRow
          task={task}
          state="idle"
          depth={0}
          ancestorLines={[]}
          isLast
          activeLane={null}
          active={false}
          childCount={childCount}
          expanded={false}
          pinned={false}
          nowSec={0}
          onOpen={vi.fn<(id: string) => void>()}
          onToggle={vi.fn<(id: string) => void>()}
          onPin={vi.fn<(id: string) => void>()}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const pullRequest = (patch: Partial<TaskPullRequest> = {}): TaskPullRequest => ({
  checks: null,
  number: 52,
  state: "open",
  title: "Ship it",
  url: "https://github.com/acme/widgets/pull/52",
  ...patch,
});

type Internals = {
  applyEvent: (event: DaemonEvent) => void;
  setState: (patch: { taskPullRequests: Record<string, TaskPullRequest> }) => void;
};
const internals = daemon as unknown as Internals;

function pushPullRequest(value: TaskPullRequest) {
  act(() =>
    internals.applyEvent({
      data: { pull_request: value, task_id: "t1" },
      event: "task.pullRequest",
    }),
  );
}

function mockFactory(entries: Record<string, unknown>[], hold: unknown = null) {
  vi.spyOn(daemon, "runnerStatus").mockResolvedValue(
    normalizeRunnerStatus("demo", { entries, hold }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(openExternalLink).mockReset();
  act(() => internals.setState({ taskPullRequests: {} }));
});

describe("SidebarTaskRow pull requests", () => {
  it("merges a Factory task's PR into one chip and drops the separate glyph", async () => {
    mockFactory([
      { deliver: true, prNumber: 52, project: "demo", state: "delivered", taskId: "t1" },
    ]);
    const { container } = renderRow({ ...base, tags: ["runner"] });
    pushPullRequest(pullRequest({ checks: "failing", failedChecks: [] }));

    const chip = await screen.findByText("PR #52");
    expect(chip.closest("[data-factory-pr='open']")).not.toBeNull();
    expect(container.querySelector("[data-task-pr-checks='failing']")).not.toBeNull();
    // One indicator only: no separate glyph.
    expect(container.querySelector("[data-task-pr]")).toBeNull();
  });

  it("opens the pull request when the chip is clicked, without opening the task", async () => {
    mockFactory([
      { deliver: true, prNumber: 52, project: "demo", state: "delivered", taskId: "t1" },
    ]);
    const user = userEvent.setup();
    const onOpen = vi.fn<(id: string) => void>();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <SidebarTaskRow
            task={{ ...base, tags: ["runner"] }}
            state="idle"
            depth={0}
            ancestorLines={[]}
            isLast
            activeLane={null}
            active={false}
            childCount={0}
            expanded={false}
            pinned={false}
            nowSec={0}
            onOpen={onOpen}
            onToggle={vi.fn<(id: string) => void>()}
            onPin={vi.fn<(id: string) => void>()}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    pushPullRequest(pullRequest());

    await user.click(await screen.findByText("PR #52"));
    expect(openExternalLink).toHaveBeenCalledWith("https://github.com/acme/widgets/pull/52");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps the glyph for a plain worktree task", () => {
    const { container } = renderRow({ ...base, tags: [], worktree: "/repo/.warpforge/wt/t1" });
    pushPullRequest(pullRequest());

    expect(container.querySelector("[data-task-pr='open']")).not.toBeNull();
    expect(container.querySelector("[data-factory-pr]")).toBeNull();
  });
});

describe("SidebarTaskRow group glyphs", () => {
  it("gives a Factory pipeline the workflow glyph, not Users", () => {
    mockFactory([{ deliver: true, project: "demo", state: "running", taskId: "t1" }]);
    const { container } = renderRow(
      {
        ...base,
        tags: ["runner"],
        workflowRun: {
          maxRounds: 3,
          round: 1,
          stage: "implement",
          workflowId: "w",
          workflowName: "W",
        },
      },
      2,
    );

    expect(screen.getByTitle("Factory pipeline · 2 stages")).toBeInTheDocument();
    expect(container.querySelector(".lucide-workflow")).not.toBeNull();
    expect(container.querySelector(".lucide-users")).toBeNull();
  });

  it("keeps Users for an orchestrator task", () => {
    const { container } = renderRow({ ...base, tags: ["orchestrator-chat"] });
    expect(screen.getByTitle("Orchestrator lead")).toBeInTheDocument();
    expect(container.querySelector(".lucide-users")).not.toBeNull();
    expect(container.querySelector(".lucide-workflow")).toBeNull();
  });
});
