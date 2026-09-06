import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { MouseEvent } from "react";

import { daemon } from "../../daemon";

import { showContextMenu, useNativeContextMenu } from "../../hooks/useNativeContextMenu";
import type { ShowContextMenuRequest } from "../../hooks/useNativeContextMenu";
import type { FileDiff } from "../../protocol";
import type { FlatRow } from "./treeUtils";
import { useChangesContextMenu } from "./useChangesContextMenu";

vi.mock("../../hooks/useNativeContextMenu", () => ({
  showContextMenu: vi.fn<(request: ShowContextMenuRequest) => Promise<void>>(),
  useNativeContextMenu: vi.fn<(requestId: string, handlers: Map<string, () => void>) => void>(),
}));

const showMenu = showContextMenu as Mock;
const wireMenu = useNativeContextMenu as Mock;

const changedFile: FileDiff = {
  hunks: [
    {
      lines: ["-two", "+TWO"],
      newLines: 1,
      newStart: 2,
      oldLines: 1,
      oldStart: 2,
      resolution: null,
    },
  ],
  oldPath: null,
  path: "src/a.ts",
  status: "modified",
};

const baseProps = {
  filesByPath: new Map([["src/a.ts", changedFile]]),
  onRefresh: vi.fn<() => void>(),
  onSelect: vi.fn<(path: string) => void>(),
  onShelve: vi.fn<(paths: string[]) => void>(),
  onStash: vi.fn<(paths: string[]) => void>(),
  staged: new Set<string>(["src/a.ts"]),
  taskId: "task-1",
  toggle: vi.fn<(paths: string[], on: boolean) => void>(),
  untrackedPaths: ["new.txt"],
};

type Handler = (e: MouseEvent, row: FlatRow) => void;

function renderHook(props: Partial<typeof baseProps> = {}): {
  handler: Handler;
  handlers: Map<string, () => void>;
} {
  let handler!: Handler;
  render(
    <Harness
      props={{ ...baseProps, ...props }}
      onHandler={(h) => {
        handler = h;
      }}
    />,
  );
  const handlers = wireMenu.mock.calls[wireMenu.mock.calls.length - 1][1] as Map<
    string,
    () => void
  >;
  return { handler, handlers };
}

function Harness({
  props,
  onHandler,
}: {
  props: typeof baseProps;
  onHandler: (h: Handler) => void;
}) {
  const handler = useChangesContextMenu(props);
  onHandler(handler);
  return null;
}

const fakeEvent = () =>
  ({ preventDefault: () => {}, stopPropagation: () => {} }) as unknown as MouseEvent;

const fileRow = (path: string): FlatRow => ({
  depth: 0,
  key: path,
  node: { children: new Map(), name: path.split("/").pop()!, path },
});

const folderRow = (paths: string[]): FlatRow => ({
  depth: 0,
  key: "folder",
  node: {
    children: new Map(
      paths.map((p) => [p, { children: new Map(), name: p, path: p }]),
    ),
    name: "folder",
  },
});

const labels = () => {
  const calls = showMenu.mock.calls;
  return (calls[calls.length - 1][0].items as { type: string; label?: string }[])
    .filter((i) => i.type === "item")
    .map((i) => i.label!);
};

describe("useChangesContextMenu", () => {
  beforeEach(() => {
    vi.spyOn(daemon, "request").mockResolvedValue(null);
    Object.assign(navigator, { clipboard: { writeText: vi.fn<(text: string) => void>() } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("gives a tracked file one Stage/Unstage, not two", () => {
    const { handler } = renderHook();

    handler(fakeEvent(), fileRow("src/a.ts"));

    const names = labels();
    expect(names.filter((l) => l === "Unstage" || l === "Stage")).toHaveLength(1);
    expect(names).toEqual([
      "Unstage",
      "Show Diff",
      "Jump to Source",
      "Shelve…",
      "Stash…",
      "Rollback File",
      "Copy as Patch to Clipboard",
      "Copy Path",
      "Refresh",
    ]);
  });

  it("gives an unversioned file Add to VCS / gitignore / Delete, no Stage or Rollback", () => {
    const { handler } = renderHook({ staged: new Set() });

    handler(fakeEvent(), fileRow("new.txt"));

    expect(labels()).toEqual([
      "Add to VCS",
      "Add to .gitignore",
      "Show Diff",
      "Jump to Source",
      "Shelve…",
      "Stash…",
      "Copy as Patch to Clipboard",
      "Copy Path",
      "Delete…",
      "Refresh",
    ]);
  });

  it("opens the Shelve dialog for the target, in both sections", () => {
    const onShelve = vi.fn<(paths: string[]) => void>();
    const { handler, handlers } = renderHook({ onShelve, staged: new Set() });

    handler(fakeEvent(), fileRow("new.txt"));
    expect(labels()).toContain("Shelve…");
    handlers.get("shelve")!();
    expect(onShelve).toHaveBeenCalledWith(["new.txt"]);

    handler(fakeEvent(), fileRow("src/a.ts"));
    handlers.get("shelve")!();
    expect(onShelve).toHaveBeenCalledWith(["src/a.ts"]);
  });

  it("adds the file to VCS and refreshes", async () => {
    const onRefresh = vi.fn<() => void>();
    const { handler, handlers } = renderHook({ onRefresh });

    handler(fakeEvent(), fileRow("new.txt"));
    handlers.get("addVcs")!();

    await waitFor(() =>
      expect(daemon.request).toHaveBeenCalledWith("git.add", {
        paths: ["new.txt"],
        task_id: "task-1",
      }),
    );
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("appends to .gitignore and refreshes", async () => {
    const onRefresh = vi.fn<() => void>();
    const { handler, handlers } = renderHook({ onRefresh });

    handler(fakeEvent(), fileRow("new.txt"));
    handlers.get("ignore")!();

    await waitFor(() =>
      expect(daemon.request).toHaveBeenCalledWith("git.ignore", {
        paths: ["new.txt"],
        task_id: "task-1",
      }),
    );
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("deletes the file from disk and refreshes", async () => {
    const onRefresh = vi.fn<() => void>();
    const { handler, handlers } = renderHook({ onRefresh });

    handler(fakeEvent(), fileRow("new.txt"));
    handlers.get("del")!();

    await waitFor(() =>
      expect(daemon.request).toHaveBeenCalledWith("file.delete", {
        path: "new.txt",
        task_id: "task-1",
      }),
    );
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("copies the file as a patch to the clipboard", () => {
    const { handler, handlers } = renderHook();

    handler(fakeEvent(), fileRow("src/a.ts"));
    handlers.get("copyPatch")!();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("--- a/src/a.ts\n+++ b/src/a.ts\n@@ -2,1 +2,1 @@\n-two\n+TWO\n"),
    );
  });

  it("gives an unversioned folder Add to VCS, a tracked one Stage folder", () => {
    const { handler } = renderHook();

    handler(fakeEvent(), folderRow(["new.txt"]));
    expect(labels()).toEqual([
      "Add to VCS",
      "Add to .gitignore",
      "Shelve…",
      "Stash…",
      "Copy Path",
      "Refresh",
    ]);

    handler(fakeEvent(), folderRow(["src/a.ts"]));
    expect(labels()).toEqual(["Unstage folder", "Shelve…", "Stash…", "Copy Path", "Refresh"]);
  });

  it("opens the Stash dialog for the target", () => {
    const onStash = vi.fn<(paths: string[]) => void>();
    const { handler, handlers } = renderHook({ onStash });

    handler(fakeEvent(), fileRow("src/a.ts"));
    expect(labels()).toContain("Stash…");
    handlers.get("stash")!();
    expect(onStash).toHaveBeenCalledWith(["src/a.ts"]);
  });
});
