import { render } from "@testing-library/react";
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
        onAction={noop}
        onToggleFolder={noop}
      />,
    );

    expect(localRows[0]?.branch).toBe("main");
    const remote = container.querySelector<HTMLElement>('[data-branch="origin/main"]')!;
    expect(remote.querySelector("svg.lucide-check")).toBeNull();
    expect(remote.querySelector("svg.lucide-git-branch")).not.toBeNull();
  });
});
