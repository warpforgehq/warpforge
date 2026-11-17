import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { FileDiff, TaskDiff, TaskInfo } from "../../protocol";
import { useUi } from "../../store/ui";
import { DiffSurface } from "./DiffSurface";
import type { DiffWorkspaceHandle } from "./DiffWorkspace";

vi.mock("./DiffWorkspace", async () => {
  const { CommitWorkspace } = await import("./DiffWorkspace/CommitWorkspace");
  return {
    DiffWorkspace: (props: { diff: TaskDiff | null; editable: boolean; historical?: boolean }) =>
      props.historical ? (
        <CommitWorkspace
          {...props}
          diffError={null}
          diffView="unified"
          localRes={{}}
          taskId="task-1"
          onOpenFiles={() => {}}
          onResolve={() => {}}
          onSendToChat={() => {}}
        />
      ) : (
        <div data-testid="diff-workspace" data-editable={String(props.editable)}>
          {props.diff?.files.map((f) => f.path).join(",")}
        </div>
      ),
    estimateFileHeight: () => 384,
  };
});
vi.mock("./FileDiffSkeleton", () => ({
  FileDiffSkeleton: ({ index }: { index: number }) => (
    <div data-testid="file-skeleton" data-index={index} />
  ),
}));
vi.mock("../../components/ChangesRail", () => ({
  ChangesRail: ({ commitsPanel }: { commitsPanel: ReactNode }) => (
    <div data-testid="changes-rail">{commitsPanel}</div>
  ),
}));

const fixture = vi.hoisted(() => ({
  snapshot: { tasks: [{ id: "task-1", project: "warpforge", worktree: "/wt" }] },
  pr: null as unknown,
}));
vi.mock("@/daemon", () => ({
  daemon: {
    subscribe: () => () => {},
    getState: () => ({ snapshot: fixture.snapshot }),
    branchCommits: async () => [
      { hash: "abc", shortHash: "abc", subject: "Feature", author: "Dev", date: "", pushed: true },
    ],
    commitDiff: async () => ({
      files: [
        {
          path: "historical.ts",
          hunks: [
            { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-before", "+after"] },
          ],
          status: "modified",
        },
      ],
    }),
  },
}));
vi.mock("@/hooks/useTaskPullRequest", () => ({ useTaskPullRequest: () => fixture.pr }));
vi.mock("@/components/pullRequest/TaskPullRequestChip", () => ({
  TaskPullRequestChip: () => <span>PR status link</span>,
}));
vi.mock("../push/useBranchActions", () => ({
  branchCommitsKey: (taskId: string) => ["branchCommits", taskId],
  useBranchActions: () => ({
    info: null,
    loading: false,
    pushing: null,
    menuOpen: false,
    setMenuOpen: () => {},
    repositoryOperation: null,
    error: null,
    mode: "push",
    setMode: () => {},
    push: () => {},
  }),
}));

function taskDiff(count: number): TaskDiff {
  const files: FileDiff[] = Array.from({ length: count }, (_, index) => ({
    hunks: [],
    oldPath: null,
    path: `src/file-${index}.ts`,
    status: "modified",
  }));
  return {
    branch: "main",
    files,
    ignored: [],
    ignoredAvailable: true,
    ignoredTruncated: false,
    taskId: "task-1",
    untrackedAvailable: true,
    untrackedPaths: [],
  };
}

function renderSurface(overrides: { diff?: TaskDiff | null; baseBranch?: string } = {}) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <DiffSurface
        commitExpanded={false}
        diff={overrides.diff ?? null}
        diffError={null}
        diffView="unified"
        diffWorkspaceRef={createRef<DiffWorkspaceHandle | null>()}
        editable
        localRes={{}}
        onCommitExpandedChange={() => {}}
        onCommitted={() => {}}
        onOpenFile={() => {}}
        onOpenFiles={() => {}}
        onRefresh={() => {}}
        onResolve={() => {}}
        onSelect={() => {}}
        onSendToChat={() => {}}
        onSetDiffView={() => {}}
        project="warpforge"
        selected={null}
        task={{ ...fixture.snapshot.tasks[0], baseBranch: overrides.baseBranch } as TaskInfo}
        taskId="task-1"
      />
    </QueryClientProvider>,
  );
}

describe("DiffSurface", () => {
  it("selects only a commit patch read-only and returns to working changes", async () => {
    fixture.pr = null;
    renderSurface({ diff: taskDiff(1) });
    await userEvent.click(await screen.findByRole("button", { name: /Feature/ }));
    expect(await screen.findByRole("button", { name: "historical.ts" })).toBeInTheDocument();
    expect(screen.getByText("before")).toBeInTheDocument();
    expect(screen.getByText("after")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /comment|viewed/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back to working changes" }));
    expect(screen.getByTestId("diff-workspace")).toHaveTextContent("src/file-0.ts");
    expect(screen.getByTestId("diff-workspace")).toHaveAttribute("data-editable", "true");
  });

  it.each(["main", "master", "release"])("disables PR creation on base branch %s", (branch) => {
    fixture.pr = null;
    renderSurface({ diff: { ...taskDiff(0), branch }, baseBranch: "release" });
    const button = screen.getAllByRole("button", { name: "Create PR" })[0];
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Switch to a feature branch to create a pull request");
  });

  it("offers Create PR without a PR, and shows compact PR status with one", () => {
    fixture.pr = null;
    const first = renderSurface();
    expect(screen.getByRole("button", { name: "Create PR" })).toBeInTheDocument();
    first.unmount();
    fixture.pr = { number: 12 };
    const second = renderSurface();
    expect(screen.getByText("PR status link")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create PR" })).not.toBeInTheDocument();
    second.unmount();
    fixture.pr = null;
  });

  it("paints the shell first and mounts the workspace a frame later", async () => {
    renderSurface();

    // The turn Inbox → Tasks is genuinely synchronous: the shell and its
    // skeleton commit before the diff's editors are asked to mount.
    expect(screen.getByTestId("diff-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("diff-workspace")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("diff-workspace")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("diff-skeleton")).not.toBeInTheDocument();
  });

  it("shows one file skeleton per loading file, never per-file loading text", () => {
    renderSurface({ diff: taskDiff(3) });

    expect(screen.getAllByTestId("file-skeleton")).toHaveLength(3);
    expect(screen.queryByText("Loading changes…")).not.toBeInTheDocument();
  });

  it("caps the shell skeleton and still draws some before a diff arrives", () => {
    const { unmount } = renderSurface({ diff: taskDiff(20) });
    expect(screen.getAllByTestId("file-skeleton")).toHaveLength(6);
    unmount();

    renderSurface();
    expect(screen.getAllByTestId("file-skeleton")).toHaveLength(3);
  });

  it("reserves the changes rail with a tree-shaped skeleton, never a sentence", () => {
    renderSurface();

    expect(screen.getByTestId("changes-rail-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("Loading changes…")).not.toBeInTheDocument();
  });

  it("keeps the changes rail mounted across a fold, so its state is not rebuilt", async () => {
    useUi.setState({ diffPanelCollapsed: false });
    renderSurface({ diff: taskDiff(2) });
    const rail = () => screen.queryByTestId("changes-rail");

    expect(rail()).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Collapse changes panel" }));
    // Folded, not unmounted: keepMounted leaves the rail's tab and scroll on
    // the element that stays in the tree, so expanding again is not a rebuild.
    expect(rail()).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Expand changes panel" }));
    expect(rail()).toBeInTheDocument();
  });
});

it("disables the History Create PR action for an existing PR", () => {
  fixture.pr = { number: 12 };
  renderSurface({ diff: { ...taskDiff(1), branch: "feature" } });
  const button = screen.getByRole("button", { name: "Create PR" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("title", "This task already has a pull request");
  fixture.pr = null;
});
