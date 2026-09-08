import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetPullViewedCache } from "@/lib/pullViewed";
import type { PullRequestDiff, PullRequestSummary } from "@/protocol";
import { useUi } from "@/store/ui";

const { renders } = vi.hoisted(() => ({ renders: [] as string[] }));

vi.mock("@/daemon", () => ({ daemon: {} }));

// Counting the rows is the only way to see the work: a file that re-renders
// re-renders every one of its lines, which is what made a 10k-line diff hang.
vi.mock("./PullDiffLines", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./PullDiffLines")>();
  return {
    ...actual,
    PullDiffLines: ({ hunk }: { hunk: { id: string } }) => {
      renders.push(hunk.id);
      return <div data-testid={`hunk-${hunk.id}`} />;
    },
  };
});

vi.mock("@/lib/pullDiffHighlight", () => ({
  highlightPatchBlock: vi.fn<() => Promise<Map<string, never>>>(
    async () => new Map<string, never>(),
  ),
}));

import { PullDiffView } from "./PullDiffView";

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

function file(path: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,2 +1,2 @@",
    " kept",
    "-old",
    "+new",
  ].join("\n");
}

const diff: PullRequestDiff = {
  additions: 2,
  deletions: 2,
  files: [
    { path: "src/a.ts", additions: 1, deletions: 1 },
    { path: "src/b.ts", additions: 1, deletions: 1 },
  ],
  patch: `${file("src/a.ts")}\n${file("src/b.ts")}`,
  truncated: false,
};

describe("PullDiffView re-render scope", () => {
  beforeEach(() => {
    renders.length = 0;
    window.localStorage.clear();
    resetPullViewedCache();
    useUi.setState({ diffView: "unified", pullFilesPanelCollapsed: true });
  });

  it("re-renders one file's rows when that file is ticked off, not the other's", async () => {
    const user = userEvent.setup();
    render(
      <PullDiffView
        pr={pr}
        diff={diff}
        thread={null}
        commits={[]}
        range={null}
        onRangeChange={() => {}}
        onThreadChanged={() => {}}
      />,
    );

    const initial = renders.length;
    expect(initial).toBe(2);
    renders.length = 0;

    // Ticking the first file off folds it; the second file's rows must not be
    // rebuilt for it. Every `PullDiffFile` prop is stable or `undefined` for
    // the files a change does not touch — that is what this pins.
    await user.click(screen.getAllByRole("button", { name: "Viewed" })[0]);

    expect(renders).toEqual([]);
  });

  it("rebuilds the rows once per file when the unified/split switch flips", async () => {
    const user = userEvent.setup();
    render(
      <PullDiffView
        pr={pr}
        diff={diff}
        thread={null}
        commits={[]}
        range={null}
        onRangeChange={() => {}}
        onThreadChanged={() => {}}
      />,
    );
    renders.length = 0;

    await user.click(screen.getByRole("button", { name: "split" }));

    // Two files, one hunk each: the mode genuinely changed every row, so this
    // is the floor, not a regression. Anything above it is a re-render loop.
    expect(renders.length).toBe(2);
  });
});
