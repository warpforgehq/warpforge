import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { daemon } from "@/daemon";
import { normalizeKeeperState } from "@/lib/keepers";
import type { DaemonEvent, KeeperTaskState, TaskInfo, TaskPullRequest } from "@/protocol";
import { finding, run } from "@/test/keepers";

import { TaskPullRequestChip } from "./TaskPullRequestChip";
import { TaskPullRequestGlyph } from "./TaskPullRequestGlyph";

const task: TaskInfo = {
  agent: "codex",
  blockedReason: null,
  createdAt: 1,
  filesChanged: 0,
  id: "t1",
  project: "warpforge",
  prompt: "Fix the sidebar",
  status: "waiting",
  tags: [],
  title: "Fix the sidebar",
  updatedAt: 1,
  worktree: "/repo/.warpforge/worktrees/t1",
};

const pr = (patch: Partial<TaskPullRequest> = {}): TaskPullRequest => ({
  checks: null,
  number: 12,
  state: "open",
  title: "Fix the sidebar",
  url: "https://github.com/acme/widgets/pull/12",
  ...patch,
});

type Internals = {
  applyEvent: (event: DaemonEvent) => void;
  setState: (patch: {
    taskPullRequests?: Record<string, TaskPullRequest>;
    taskKeepers?: Record<string, KeeperTaskState>;
  }) => void;
};
const internals = daemon as unknown as Internals;

function push(pullRequest: TaskPullRequest | null, taskId = "t1") {
  act(() =>
    internals.applyEvent({
      data: { pull_request: pullRequest, task_id: taskId },
      event: "task.pullRequest",
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  act(() => internals.setState({ taskKeepers: {}, taskPullRequests: {} }));
});

describe("task pull request", () => {
  it("draws nothing for a task without one", () => {
    const { container } = render(<TaskPullRequestGlyph taskId="t1" receded={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("marks failing checks on the sidebar glyph and leaves passing ones quiet", () => {
    const { container } = render(<TaskPullRequestGlyph taskId="t1" receded={false} />);
    push(pr({ checks: "failing" }));
    expect(container.querySelector("[data-task-pr='open']")).not.toBeNull();
    expect(container.querySelector("[data-task-pr-checks='failing']")).not.toBeNull();
    expect(screen.getByTitle("PR #12 · Open · Checks failing")).toBeInTheDocument();

    push(pr({ checks: "passing" }));
    expect(container.querySelector("[data-task-pr-checks]")).toBeNull();

    push(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("overlays the keepers' worst state on the glyph and the chip", () => {
    const keepers = (
      runs: Parameters<typeof run>[0][],
      findings: Parameters<typeof finding>[0][] = [],
    ) =>
      act(() =>
        internals.setState({
          taskKeepers: {
            t1: {
              ...normalizeKeeperState("t1", null),
              findings: findings.map(finding),
              runs: runs.map(run),
            },
          },
        }),
      );
    vi.spyOn(daemon, "request").mockResolvedValue({ pullRequests: {} });
    const { container } = render(
      <>
        <TaskPullRequestGlyph taskId="t1" receded={false} />
        <TaskPullRequestChip task={task} />
      </>,
    );
    push(pr());
    keepers([{ id: "r1", outcome: null }]);
    expect(container.querySelectorAll("[data-task-keepers='running']")).toHaveLength(2);
    expect(screen.getByTitle("PR #12 · Open · Keepers checking")).toBeInTheDocument();

    keepers([{ count: 1, id: "r1", outcome: "findings" }], [{ id: "f1", runId: "r1" }]);
    expect(container.querySelectorAll("[data-task-keepers='failing']")).toHaveLength(2);
    expect(
      screen.getByRole("button", {
        name: "PR #12 · Open · Keepers need attention: open on GitHub",
      }),
    ).toBeInTheDocument();

    keepers([{ id: "r1" }]);
    expect(container.querySelector("[data-task-keepers]")).toBeNull();
  });

  it("refreshes and renders an owned project-folder task", () => {
    const request = vi.spyOn(daemon, "request").mockResolvedValue({ pullRequests: {} });
    const folder = {
      ...task,
      worktree: undefined,
    };
    const { container } = render(
      <>
        <TaskPullRequestGlyph taskId={folder.id} receded={false} />
        <TaskPullRequestChip task={folder} />
      </>,
    );
    expect(request).toHaveBeenCalledWith("task.pullRequests", {
      task_ids: [folder.id],
      max_age_secs: 15,
    });
    push(pr());
    expect(container.querySelectorAll("[data-task-pr='open']")).toHaveLength(2);
  });

  it("offers archiving a merged task, and removes the worktree only once confirmed", async () => {
    const user = userEvent.setup();
    vi.spyOn(daemon, "request").mockResolvedValue({ pullRequests: {} });
    const archive = vi.spyOn(daemon, "archiveTask").mockResolvedValue();
    render(<TaskPullRequestChip task={task} />);
    push(pr({ state: "merged" }));

    expect(screen.getByRole("button", { name: /PR #12 · Merged/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Archive and remove worktree" }));
    expect(archive).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Archive and remove" }));
    await vi.waitFor(() => expect(archive).toHaveBeenCalledWith("t1", true));
  });

  it("re-checks the opened task's pull request", () => {
    const request = vi.spyOn(daemon, "request").mockResolvedValue({ pullRequests: {} });
    render(<TaskPullRequestChip task={task} />);
    expect(request).toHaveBeenCalledWith("task.pullRequests", {
      max_age_secs: 15,
      task_ids: ["t1"],
    });
  });

  it("does not let an older reply undo a newer event", async () => {
    let answer!: (value: unknown) => void;
    vi.spyOn(daemon, "request").mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const pending = daemon.refreshTaskPullRequests();
    push(pr({ state: "merged" }));
    answer({ pullRequests: { t1: pr(), t2: pr({ number: 3 }) } });
    await pending;

    const cached = daemon.getState().taskPullRequests ?? {};
    expect(cached.t1?.state).toBe("merged");
    expect(cached.t2?.number).toBe(3);
  });
});
