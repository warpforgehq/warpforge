import { useCallback, useMemo, useRef, type MouseEvent } from "react";

import { daemon } from "../../daemon";
import {
  showContextMenu,
  useNativeContextMenu,
  type ContextMenuItemOrSeparator,
} from "../../hooks/useNativeContextMenu";
import type { FileDiff } from "../../protocol";
import { toUnifiedPatch } from "./filePatch";
import { leaves, type FlatRow } from "./treeUtils";
import { reportGitFailure } from "./reportGitFailure";

/**
 * Right-click menu for a Changes rail row. Tracked and unversioned files get
 * different menus — the sections mean different things, so their actions do
 * too:
 *
 * - Changes: stage/unstage the commit checkbox, roll the file back.
 * - Unversioned: `git add` the file into Changes ("Add to VCS"), append it
 *   to `.gitignore`, or delete it from disk. Stage/rollback make no sense
 *   here — the file is not in git at all.
 *
 * Both share Show Diff / Jump to Source / Copy as Patch to Clipboard /
 * Copy Path / Refresh. Folders get the section menu matching their contents.
 */
export function useChangesContextMenu({
  filesByPath,
  onRefresh,
  onSelect,
  onShelve,
  onStash,
  staged,
  taskId,
  toggle,
  untrackedPaths,
}: {
  filesByPath: Map<string, FileDiff>;
  onRefresh: () => void;
  onSelect: (path: string) => void;
  /** Open the Shelve dialog for these paths. */
  onShelve: (paths: string[]) => void;
  /** Open the Stash dialog for these paths. */
  onStash: (paths: string[]) => void;
  staged: Set<string>;
  taskId: string;
  toggle: (paths: string[], on: boolean) => void;
  /** Paths git does not track yet — the "Unversioned Files" section. */
  untrackedPaths: string[];
}) {
  const untracked = useMemo(() => new Set(untrackedPaths), [untrackedPaths]);
  const requestId = useRef(`changes-${taskId}`).current;
  const targetRef = useRef<{ kind: "file" | "folder"; path?: string; paths: string[] } | null>(
    null,
  );

  const fileItems = useCallback(
    (path: string): ContextMenuItemOrSeparator[] => {
      const shared: ContextMenuItemOrSeparator[] = [
        { type: "item", id: "open", label: "Show Diff" },
        { type: "item", id: "jump", label: "Jump to Source" },
      ];
      const tail: ContextMenuItemOrSeparator[] = [
        { type: "item", id: "copyPatch", label: "Copy as Patch to Clipboard" },
        { type: "item", id: "copy", label: "Copy Path" },
      ];
      if (untracked.has(path)) {
        return [
          { type: "item", id: "addVcs", label: "Add to VCS" },
          { type: "item", id: "ignore", label: "Add to .gitignore" },
          { type: "separator" },
          ...shared,
          { type: "separator" },
          { type: "item", id: "shelve", label: "Shelve…" },
          { type: "item", id: "stash", label: "Stash…" },
          ...tail,
          { type: "item", id: "del", label: "Delete…" },
          { type: "separator" },
          { type: "item", id: "refresh", label: "Refresh" },
        ];
      }
      return [
        {
          type: "item",
          id: "toggle",
          label: staged.has(path) ? "Unstage" : "Stage",
        },
        ...shared,
        { type: "separator" },
        { type: "item", id: "shelve", label: "Shelve…" },
        { type: "item", id: "stash", label: "Stash…" },
        { type: "item", id: "rollback", label: "Rollback File" },
        { type: "separator" },
        ...tail,
        { type: "item", id: "refresh", label: "Refresh" },
      ];
    },
    [staged, untracked],
  );

  const handleContextMenu = useCallback(
    (e: MouseEvent, row: FlatRow) => {
      e.preventDefault();
      e.stopPropagation();
      const path = row.node.path;
      if (path) {
        targetRef.current = { kind: "file", path, paths: [path] };
        void showContextMenu({ requestId, items: fileItems(path) });
        return;
      }
      const paths = leaves(row.node);
      targetRef.current = { kind: "folder", paths };
      const folderUntracked = paths.length > 0 && paths.every((p) => untracked.has(p));
      const items: ContextMenuItemOrSeparator[] = folderUntracked
        ? [
            { type: "item", id: "addVcs", label: "Add to VCS" },
            { type: "item", id: "ignore", label: "Add to .gitignore" },
            { type: "separator" },
            { type: "item", id: "shelve", label: "Shelve…" },
            { type: "item", id: "stash", label: "Stash…" },
            { type: "item", id: "copy", label: "Copy Path" },
            { type: "item", id: "refresh", label: "Refresh" },
          ]
        : [
            {
              type: "item",
              id: "toggle",
              label: paths.every((p) => staged.has(p)) ? "Unstage folder" : "Stage folder",
            },
            { type: "separator" },
            { type: "item", id: "shelve", label: "Shelve…" },
            { type: "item", id: "stash", label: "Stash…" },
            { type: "item", id: "copy", label: "Copy Path" },
            { type: "item", id: "refresh", label: "Refresh" },
          ];
      void showContextMenu({ requestId, items });
    },
    [fileItems, requestId, staged, untracked],
  );

  const mutate = useCallback(
    (paths: string[], method: string, failure: string) => {
      void daemon
        .request(method, { paths, task_id: taskId })
        .then(onRefresh)
        .catch((e: unknown) => reportGitFailure(failure, e));
    },
    [onRefresh, taskId],
  );

  const menuHandlers = useMemo(
    () =>
      new Map<string, () => void>([
        [
          "toggle",
          () => {
            const t = targetRef.current;
            if (!t) return;
            const on =
              t.kind === "file" ? !staged.has(t.path!) : !t.paths.every((p) => staged.has(p));
            toggle(t.paths, on);
          },
        ],
        [
          "open",
          () => {
            const t = targetRef.current;
            if (t && t.path) onSelect(t.path);
          },
        ],
        [
          "jump",
          () => {
            const t = targetRef.current;
            if (t?.path) onSelect(t.path);
          },
        ],
        ["addVcs", () => {
          const t = targetRef.current;
          if (t) mutate(t.paths, "git.add", "Could not add to VCS");
        }],
        ["shelve", () => {
          const t = targetRef.current;
          if (t) onShelve(t.paths);
        }],
        ["stash", () => {
          const t = targetRef.current;
          if (t) onStash(t.paths);
        }],
        ["ignore", () => {
          const t = targetRef.current;
          if (t) mutate(t.paths, "git.ignore", "Could not update .gitignore");
        }],
        [
          "del",
          () => {
            const t = targetRef.current;
            if (t?.kind !== "file" || !t.path) return;
            void daemon
              .request("file.delete", { path: t.path, task_id: taskId })
              .then(onRefresh)
              .catch((e: unknown) => reportGitFailure("Could not delete the file", e));
          },
        ],
        [
          "copyPatch",
          () => {
            const t = targetRef.current;
            if (t?.kind !== "file" || !t.path) return;
            const file = filesByPath.get(t.path);
            if (!file) return;
            void navigator.clipboard.writeText(toUnifiedPatch(file));
          },
        ],
        [
          "copy",
          () => {
            const t = targetRef.current;
            if (t) void navigator.clipboard.writeText(t.paths.join("\n"));
          },
        ],
        ["refresh", onRefresh],
        [
          "rollback",
          () => {
            const t = targetRef.current;
            if (!t?.path) return;
            const file = filesByPath.get(t.path);
            if (!file) return;
            const indices = file.status === "added" ? [0] : file.hunks.map((_, i) => i).reverse();
            void Promise.all(
              indices.map((hunkIndex) =>
                daemon.request("diff.resolveHunk", {
                  file: t.path,
                  hunk_index: hunkIndex,
                  resolution: "reject",
                  task_id: taskId,
                }),
              ),
            ).then(onRefresh);
          },
        ],
      ]),
    [filesByPath, mutate, onRefresh, onSelect, onShelve, onStash, staged, taskId, toggle],
  );
  useNativeContextMenu(requestId, menuHandlers);

  return handleContextMenu;
}
