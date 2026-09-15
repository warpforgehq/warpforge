import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseUnifiedPatch } from "@/lib/pullDiff";
import {
  fingerprintPatchFile,
  pullViewedKey,
  resetPullViewedCache,
  setPullFileViewed,
} from "@/lib/pullViewed";
import type { PullRequestDiff, PullRequestSummary } from "@/protocol";
import { useUi } from "@/store/ui";

const { createPullReviewComment, postPullComment } = vi.hoisted(() => ({
  createPullReviewComment: vi.fn<
    (
      project: string,
      number: number,
      comment: {
        path: string;
        line: number;
        side: "LEFT" | "RIGHT";
        body: string;
        startLine?: number;
        startSide?: "LEFT" | "RIGHT";
      },
    ) => Promise<{ url: string }>
  >(async () => ({ url: "https://github.test/c/1" })),
  postPullComment: vi.fn<
    (project: string, number: number, body: string, inReplyTo?: string) => Promise<string>
  >(async () => "https://github.test/c/2"),
}));

vi.mock("@/daemon", () => ({
  daemon: { createPullReviewComment, postPullComment },
}));

// Colouring is decoration and pulls in a CodeMirror grammar; the layout under
// test does not depend on it.
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

const diff: PullRequestDiff = {
  additions: 1,
  deletions: 1,
  files: [{ path: "src/a.ts", additions: 1, deletions: 1 }],
  patch: [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,2 +1,2 @@",
    " kept line",
    "-old line",
    "+new line",
  ].join("\n"),
  truncated: false,
};

/** The fingerprint the view itself would compute for `src/a.ts` in `diff`. */
const fingerprintA = fingerprintPatchFile(parseUnifiedPatch(diff.patch)[0]);

function viewElement(overrides: Partial<React.ComponentProps<typeof PullDiffView>> = {}) {
  return (
    <PullDiffView
      pr={pr}
      diff={diff}
      thread={null}
      commits={[]}
      range={null}
      onRangeChange={() => {}}
      onThreadChanged={() => {}}
      {...overrides}
    />
  );
}

function renderView(overrides: Partial<React.ComponentProps<typeof PullDiffView>> = {}) {
  return render(viewElement(overrides));
}

/** The kind of change set the bracket keys are meant to walk. */
const threeFileDiff: PullRequestDiff = {
  additions: 3,
  deletions: 3,
  files: [
    { path: "src/a.ts", additions: 1, deletions: 1 },
    { path: "src/b.ts", additions: 1, deletions: 1 },
    { path: "src/c.ts", additions: 1, deletions: 1 },
  ],
  patch: [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,2 +1,2 @@",
    " kept",
    "-old a",
    "+new a",
    "diff --git a/src/b.ts b/src/b.ts",
    "--- a/src/b.ts",
    "+++ b/src/b.ts",
    "@@ -1,2 +1,2 @@",
    " kept",
    "-old b",
    "+new b",
    "diff --git a/src/c.ts b/src/c.ts",
    "--- a/src/c.ts",
    "+++ b/src/c.ts",
    "@@ -1,2 +1,2 @@",
    " kept",
    "-old c",
    "+new c",
  ].join("\n"),
  truncated: false,
};

/** Mounts with no patch, then lets one arrive — so no file is active yet. */
function renderNoActiveFile() {
  const view = renderView({ diff: null, loading: true });
  view.rerender(viewElement({ diff: threeFileDiff }));
  return view;
}

describe("PullDiffView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    // The viewed marks keep an in-memory copy, so clearing storage is not
    // enough to isolate one test from the next.
    resetPullViewedCache();
    useUi.setState({
      diffView: "unified",
      pullFilesPanelCollapsed: false,
    });
  });

  it("opens the first file and shows the patch", () => {
    renderView();
    expect(screen.getByText("@@ -1,2 +1,2 @@")).toBeInTheDocument();
    expect(screen.getByText("new line")).toBeInTheDocument();
  });

  it("switches between unified and split without refetching anything", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: "split" }));
    expect(useUi.getState().diffView).toBe("split");
    // Both revisions of the changed line stay on screen, now side by side.
    expect(screen.getByText("old line")).toBeInTheDocument();
    expect(screen.getByText("new line")).toBeInTheDocument();
  });

  it("counts a file off once it is marked viewed", async () => {
    const user = userEvent.setup();
    renderView();
    expect(screen.getByText("0/1 viewed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Viewed" }));
    expect(screen.getByText("1/1 viewed")).toBeInTheDocument();
    // Ticking it off collapses it: the reviewer is done with that file.
    expect(screen.queryByText("@@ -1,2 +1,2 @@")).not.toBeInTheDocument();
  });

  it("ticks a file off from the rail, not just from its header", async () => {
    const user = userEvent.setup();
    renderView();
    // The rail's tick used to be a bare glyph: the click fell through to
    // "scroll to this file" and the counter never moved.
    await user.click(screen.getByRole("checkbox", { name: "Mark src/a.ts as viewed" }));
    expect(screen.getByText("1/1 viewed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Viewed" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("checkbox", { name: "Mark src/a.ts as not viewed" }));
    expect(screen.getByText("0/1 viewed")).toBeInTheDocument();
  });

  it("unticks a file it ticked off", async () => {
    const user = userEvent.setup();
    renderView();
    const viewed = () => screen.getByRole("button", { name: "Viewed" });

    await user.click(viewed());
    expect(viewed()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("1/1 viewed")).toBeInTheDocument();

    await user.click(viewed());
    expect(viewed()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("0/1 viewed")).toBeInTheDocument();
    // Unticking brings the file back open.
    expect(screen.getByText("@@ -1,2 +1,2 @@")).toBeInTheDocument();
  });

  it("reopens a pull request with its ticked-off files already folded", () => {
    setPullFileViewed(pullViewedKey(pr), "src/a.ts", fingerprintA, true);
    renderView();
    // Viewed marks survive a reload and the folded state does not, so the
    // folded state is derived from them rather than starting empty.
    expect(screen.getByRole("button", { name: "Viewed" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("@@ -1,2 +1,2 @@")).not.toBeInTheDocument();
  });

  it("does not fold a file whose mark predates its current diff", () => {
    // A mark from an earlier push of this file: same path, a fingerprint
    // that no longer matches what `diff` carries now. It must not silently
    // apply to the file as it stands today.
    setPullFileViewed(pullViewedKey(pr), "src/a.ts", "stale-fingerprint", true);
    renderView();
    expect(screen.getByRole("button", { name: "Viewed" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("0/1 viewed")).toBeInTheDocument();
    expect(screen.getByText("@@ -1,2 +1,2 @@")).toBeInTheDocument();
  });

  it("posts a new review thread from the line gutter", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: "Comment on line 2" }));
    await user.type(screen.getByLabelText("Comment body"), "this leaks");
    await user.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() =>
      expect(createPullReviewComment).toHaveBeenCalledWith("warpforge", 7, {
        body: "this leaks",
        line: 2,
        path: "src/a.ts",
        side: "RIGHT",
      }),
    );
  });

  it("covers a range when a second line is shift-clicked", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: "Comment on line 1" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("button", { name: "Comment on line 2" }));
    await user.keyboard("{/Shift}");

    expect(screen.getByText("Commenting on src/a.ts:1–2")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Comment body"), "both lines");
    await user.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() =>
      expect(createPullReviewComment).toHaveBeenCalledWith("warpforge", 7, {
        body: "both lines",
        line: 2,
        path: "src/a.ts",
        side: "RIGHT",
        startLine: 1,
        startSide: "RIGHT",
      }),
    );
  });

  it("waits for the release before offering a composer", async () => {
    const user = userEvent.setup();
    renderView();
    const gutter = screen.getByRole("button", { name: "Comment on line 2" });

    await user.pointer({ keys: "[MouseLeft>]", target: gutter });
    // Still holding: the gesture is choosing lines, not writing yet.
    expect(screen.queryByLabelText("Comment body")).not.toBeInTheDocument();

    await user.pointer({ keys: "[/MouseLeft]" });
    expect(screen.getByLabelText("Comment body")).toBeInTheDocument();
  });

  it("covers a range dragged down the gutter", async () => {
    const user = userEvent.setup();
    renderView();
    // The gesture GitHub taught everyone: press a line number, pull down,
    // release.
    await user.pointer([
      { keys: "[MouseLeft>]", target: screen.getByRole("button", { name: "Comment on line 1" }) },
      { target: screen.getByRole("button", { name: "Comment on line 2" }) },
      { keys: "[/MouseLeft]" },
    ]);
    expect(screen.getByText("Commenting on src/a.ts:1–2")).toBeInTheDocument();
  });

  it("ignores the pointer passing over a gutter when nothing is held", async () => {
    const user = userEvent.setup();
    renderView();
    await user.pointer({
      target: screen.getByRole("button", { name: "Comment on line 2" }),
    });
    expect(screen.queryByLabelText("Comment body")).not.toBeInTheDocument();
  });

  it("seeds a suggestion with the lines as they stand", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: "Comment on line 2" }));
    await user.click(screen.getByRole("button", { name: /Suggest/ }));

    expect(screen.getByLabelText("Comment body")).toHaveValue("```suggestion\nnew line\n```");
  });

  it("renders an existing thread on the line it belongs to", () => {
    renderView({
      thread: {
        comments: [
          {
            id: "c1",
            kind: "review_comment",
            author: { login: "octocat" },
            body: "rename this",
            createdAt: new Date().toISOString(),
            url: "",
            state: "",
            path: "src/a.ts",
            line: 2,
            threadId: "t1",
            resolved: false,
            replies: [],
          },
        ],
        truncated: false,
        reviewDecision: null,
        baseRefName: "main",
        headRefName: "widget",
      },
    });
    expect(screen.getByText("rename this")).toBeInTheDocument();
    expect(screen.getByText("octocat")).toBeInTheDocument();
  });

  it("keeps its toolbar and its patch while a narrowed diff loads", () => {
    // Picking a commit happens in this toolbar, so swapping the surface for a
    // spinner would close the picker mid-selection.
    renderView({
      loading: true,
      commits: [
        {
          oid: "aaa1111",
          abbreviatedOid: "aaa1111",
          parentOid: "base000",
          messageHeadline: "one",
          committedDate: "",
        },
      ],
    });
    expect(screen.getByRole("button", { name: /Commits/ })).toBeEnabled();
    expect(screen.getByText("new line")).toBeInTheDocument();
    expect(screen.getByTestId("pull-diff-body")).toHaveAttribute("aria-busy", "true");
    // The previous patch stays on screen and dims; it must never be replaced
    // by a skeleton while a commit is picked.
    expect(screen.queryByTestId("pull-diff-skeleton")).not.toBeInTheDocument();
    expect(screen.getByText("new line").closest(".opacity-50")).not.toBeNull();
  });

  it("shows the toolbar and a file-shaped skeleton before the first patch arrives", () => {
    const { container } = renderView({ diff: null, loading: true });
    expect(screen.getByRole("button", { name: /Files/ })).toBeInTheDocument();
    const skeleton = screen.getByTestId("pull-diff-skeleton");
    expect(skeleton).toHaveAttribute("role", "status");
    expect(skeleton).toHaveAttribute("aria-label", "Loading changes");
    expect(screen.getAllByTestId("file-skeleton")).toHaveLength(3);
    expect(screen.queryByText(/Loading changes/)).not.toBeInTheDocument();
    // One pulse per file block, not one per bar.
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);
  });

  it("reports a failed diff in place, keeping the controls", () => {
    renderView({ diff: null, error: new Error("gh exploded") });
    expect(screen.getByText(/Could not load the diff: gh exploded/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Files/ })).toBeInTheDocument();
  });

  it("jumps to a file picked in the rail", async () => {
    const user = userEvent.setup();
    renderView();
    const rail = screen.getByTitle("src/a.ts");
    await user.click(rail);
    expect(screen.getByText("@@ -1,2 +1,2 @@")).toBeInTheDocument();
  });

  it("ticks the file being read off with `v`", () => {
    renderView();
    fireEvent.keyDown(window, { key: "v" });
    expect(screen.getByText("1/1 viewed")).toBeInTheDocument();
  });

  it("steps past the files already ticked off with `}`", () => {
    // The forty-file motion: `]` walks every file, `}` only the ones left.
    const twoFiles: PullRequestDiff = {
      additions: 2,
      deletions: 2,
      files: [
        { path: "src/a.ts", additions: 1, deletions: 1 },
        { path: "src/b.ts", additions: 1, deletions: 1 },
        { path: "src/c.ts", additions: 1, deletions: 1 },
      ],
      patch: [
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,2 +1,2 @@",
        " kept",
        "-old a",
        "+new a",
        "diff --git a/src/b.ts b/src/b.ts",
        "--- a/src/b.ts",
        "+++ b/src/b.ts",
        "@@ -1,2 +1,2 @@",
        " kept",
        "-old b",
        "+new b",
        "diff --git a/src/c.ts b/src/c.ts",
        "--- a/src/c.ts",
        "+++ b/src/c.ts",
        "@@ -1,2 +1,2 @@",
        " kept",
        "-old c",
        "+new c",
      ].join("\n"),
      truncated: false,
    };
    const blocks = parseUnifiedPatch(twoFiles.patch);
    setPullFileViewed(pullViewedKey(pr), "src/b.ts", fingerprintPatchFile(blocks[1]), true);
    renderView({ diff: twoFiles });

    fireEvent.keyDown(window, { key: "}" });

    expect(screen.getByTitle("src/c.ts")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTitle("src/a.ts")).not.toHaveAttribute("aria-current");
  });

  it("steps from the edge the direction points at when no file is active yet", () => {
    // A patch arriving with no file selected: `]` opens the first file, `[`
    // the last. Treating the missing index as "0 − 1" made `[` open the
    // first file too.
    const first = renderNoActiveFile();
    fireEvent.keyDown(window, { key: "]" });
    expect(screen.getByTitle("src/a.ts")).toHaveAttribute("aria-current", "true");
    first.unmount();

    renderNoActiveFile();
    fireEvent.keyDown(window, { key: "[" });
    expect(screen.getByTitle("src/c.ts")).toHaveAttribute("aria-current", "true");
  });

  it("steps to the last unviewed file with `{` when no file is active yet", () => {
    // `}` and `{` used to disagree at the top of the list: `}` jumped to the
    // first unviewed file while `{` silently did nothing.
    const blocks = parseUnifiedPatch(threeFileDiff.patch);
    setPullFileViewed(pullViewedKey(pr), "src/a.ts", fingerprintPatchFile(blocks[0]), true);
    renderNoActiveFile();

    fireEvent.keyDown(window, { key: "{" });

    expect(screen.getByTitle("src/c.ts")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTitle("src/a.ts")).not.toHaveAttribute("aria-current");
  });
});
