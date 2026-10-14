import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({
  request: vi.fn<(method: string, params?: unknown) => Promise<unknown>>(),
}));

vi.mock("../../daemon", () => ({ daemon: { request } }));

import { useUi } from "../../store/ui";
import { GitWorkspaceControls } from "./GitWorkspaceControls";

function renderControls() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GitWorkspaceControls
        taskId="task-1"
        branch="main"
        onOpenCommit={vi.fn<() => void>()}
        onOpenPush={vi.fn<() => void>()}
      />
    </QueryClientProvider>,
  );
}

describe("GitWorkspaceControls branch popover", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("paints nothing while the branches resolve — a one-frame skeleton is a glitch", () => {
    request.mockImplementation(() => new Promise(() => {}));

    const { container } = renderControls();
    fireEvent.click(screen.getByTitle("Branches and Git actions"));

    // The list is local and resolves in about a frame, so the popover stays
    // silent: no sentence, and no skeleton stood in for the list.
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(container.querySelector("[aria-busy]")).toBeNull();
  });

  it("opens the owning task instead of checking out a branch its worktree holds", async () => {
    useUi.setState({ openTaskId: null });
    request.mockImplementation((method) =>
      Promise.resolve(
        method === "git.branches"
          ? {
              current: "main",
              branches: ["main", "warpforge/task/t_9"],
              worktrees: [
                {
                  branch: "warpforge/task/t_9",
                  path: "/repo/.warpforge/worktrees/t_9",
                  managed: true,
                  taskId: "t_9",
                },
              ],
            }
          : null,
      ),
    );

    renderControls();
    fireEvent.click(screen.getByTitle("Branches and Git actions"));
    fireEvent.change(screen.getByPlaceholderText("Search branches and actions"), {
      target: { value: "t_9" },
    });
    const row = await screen.findByLabelText("Open in a task's worktree");
    fireEvent.contextMenu(row.closest("[data-branch]")!);
    const openTask = await screen.findByRole("menuitem", { name: "Open task" });
    expect(screen.queryByRole("menuitem", { name: "Checkout and Update" })).toBeNull();
    fireEvent.click(openTask);

    expect(useUi.getState().openTaskId).toBe("t_9");
    expect(request).not.toHaveBeenCalledWith("git.switchBranch", expect.anything());
  });
});
