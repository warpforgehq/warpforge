import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { BranchList } from "./BranchList";
import { buildBranchTree, flattenBranchTree, type BranchRow } from "./branchTree";

function rows(branches: string[]): BranchRow[] {
  const root = buildBranchTree(branches);
  const out: BranchRow[] = [];
  flattenBranchTree(root, 0, "", new Set(), out);
  return out;
}

const noop = vi.fn<() => void>();

describe("BranchList", () => {
  it("marks the current branch at the end of its row, with nothing prefixed", () => {
    const localRows = rows(["main", "feat/one", "release"]);
    const { container } = render(
      <BranchList
        localRows={localRows}
        remoteRows={[]}
        searching={false}
        searchRows={[]}
        openFolders={new Set()}
        current="main"
        holders={new Map()}
        onAction={noop}
        onToggleFolder={noop}
      />,
    );

    const main = container.querySelector<HTMLElement>('[data-branch="main"]')!;
    const check = main.querySelector("svg.lucide-check");
    expect(check).not.toBeNull();
    // Right edge, and the row still leads with the expand chevron.
    expect(main.lastElementChild).toBe(check);
    expect(main.firstElementChild?.classList.contains("lucide-chevron-right")).toBe(true);
    expect(container.querySelector('[data-branch="release"] svg.lucide-check')).toBeNull();
  });

  it("opens the branch actions at the cursor on right-click", async () => {
    const onAction = vi.fn<(action: string, branch: string, remote: boolean) => void>();
    const { container } = render(
      <BranchList
        localRows={rows(["main"])}
        remoteRows={[]}
        searching={false}
        searchRows={[]}
        openFolders={new Set()}
        current="main"
        holders={new Map()}
        onAction={onAction}
        onToggleFolder={noop}
      />,
    );

    fireEvent.contextMenu(container.querySelector('[data-branch="main"]')!, {
      clientX: 40,
      clientY: 60,
    });
    await userEvent.click(await screen.findByRole("menuitem", { name: "Update" }));

    expect(onAction).toHaveBeenCalledWith("update", "main", false);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("lists main first, and a remote row carries no check", () => {
    const localRows = rows(["main", "feat/one", "release"]);
    const { container } = render(
      <BranchList
        localRows={localRows}
        remoteRows={[
          { branch: "origin/main", depth: 0, key: "origin/main", label: "main", remote: true },
        ]}
        searching={false}
        searchRows={[]}
        openFolders={new Set()}
        current="main"
        holders={new Map()}
        onAction={noop}
        onToggleFolder={noop}
      />,
    );

    expect(localRows[0]?.branch).toBe("main");
    const remote = container.querySelector<HTMLElement>('[data-branch="origin/main"]')!;
    expect(remote.querySelector("svg.lucide-check")).toBeNull();
    expect(remote.querySelector("svg.lucide-git-branch")).not.toBeNull();
  });

  it("marks a branch held by another worktree, and only that one", () => {
    const holders = new Map([
      [
        "warpforge/task/t_9",
        { branch: "warpforge/task/t_9", path: "/repo/.warpforge/worktrees/t_9", taskId: "t_9" },
      ],
    ]);
    const { container } = render(
      <BranchList
        localRows={[]}
        remoteRows={[]}
        searching
        searchRows={[
          { branch: "warpforge/task/t_9", depth: 0, key: "t9", label: "t_9" },
          { branch: "release", depth: 0, key: "release", label: "release" },
        ]}
        openFolders={new Set()}
        current="main"
        holders={holders}
        onAction={noop}
        onToggleFolder={noop}
      />,
    );

    const held = container.querySelector('[data-branch="warpforge/task/t_9"]')!;
    expect(held.querySelector("svg.lucide-folder-git-2")).not.toBeNull();
    expect(held.querySelector('[aria-label="Open in a task\'s worktree"]')).not.toBeNull();
    expect(container.querySelector('[data-branch="release"] svg.lucide-folder-git-2')).toBeNull();
  });
});
