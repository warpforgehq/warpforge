import { useCallback, useMemo, useRef, type MouseEvent } from "react";

import {
  type ContextMenuItemOrSeparator,
  showContextMenu,
  useNativeContextMenu,
} from "../../../hooks/useNativeContextMenu";
import type { FileSystemAction } from "../FileSystemActionDialog";
import type { ExplorerRow } from "./explorerRows";

const REQUEST_ID = "project-files";

function parentOf(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

/** The tree's native right-click menu; returns the row handler that opens it. */
export function useExplorerMenu({
  canEdit,
  rootPath,
  onOpen,
  onRefresh,
  onToggle,
  isExpanded,
  onFileAction,
}: {
  /** `file.create/rename/delete` need a task or a project to address. */
  canEdit: boolean;
  rootPath?: string;
  onOpen: (path: string) => void;
  onRefresh: () => void;
  onToggle: (dir: string) => void;
  isExpanded: (dir: string) => boolean;
  onFileAction: (action: FileSystemAction) => void;
}) {
  const targetRef = useRef<ExplorerRow | null>(null);

  const openExternalPath = useCallback(
    async (path: string, reveal: boolean) => {
      if (!("__TAURI_INTERNALS__" in window) || !rootPath) return;
      const absolute = `${rootPath.replace(/\/+$/, "")}/${path}`;
      const { openPath, revealItemInDir } = await import("@tauri-apps/plugin-opener");
      if (reveal) await revealItemInDir(absolute);
      else await openPath(absolute);
    },
    [rootPath],
  );

  const handlers = useMemo(() => {
    const withTarget = (run: (row: ExplorerRow) => void) => () => {
      const row = targetRef.current;
      if (row) run(row);
    };
    const folderOf = (row: ExplorerRow) => (row.kind === "dir" ? row.path : parentOf(row.path));
    return new Map<string, () => void>([
      ["open", withTarget((row) => onOpen(row.path))],
      ["copy", withTarget((row) => void navigator.clipboard.writeText(row.path))],
      ["reveal", withTarget((row) => void openExternalPath(row.path, true))],
      ["terminal", withTarget((row) => void openExternalPath(row.path, false))],
      ["refresh", onRefresh],
      [
        "new-file",
        withTarget((row) => onFileAction({ kind: "create-file", parent: folderOf(row) })),
      ],
      [
        "new-folder",
        withTarget((row) => onFileAction({ kind: "create-folder", parent: folderOf(row) })),
      ],
      [
        "rename",
        withTarget((row) => {
          if (row.kind === "file") onFileAction({ kind: "rename", path: row.path });
        }),
      ],
      ["delete", withTarget((row) => onFileAction({ kind: "delete", path: row.path }))],
      ["expand", withTarget((row) => !isExpanded(row.path) && onToggle(row.path))],
      ["collapse", withTarget((row) => isExpanded(row.path) && onToggle(row.path))],
    ]);
  }, [isExpanded, onFileAction, onOpen, onRefresh, onToggle, openExternalPath]);
  useNativeContextMenu(REQUEST_ID, handlers);

  return useCallback(
    (event: MouseEvent, row: ExplorerRow) => {
      event.preventDefault();
      event.stopPropagation();
      targetRef.current = row;
      const isDir = row.kind === "dir";
      const edits: ContextMenuItemOrSeparator[] = canEdit
        ? [
            { type: "separator" },
            { type: "item", id: "new-file", label: "New File…" },
            { type: "item", id: "new-folder", label: "New Folder…" },
            ...(isDir ? [] : [{ type: "item", id: "rename", label: "Rename…" } as const]),
            { type: "item", id: "delete", label: "Delete…" },
          ]
        : [];
      const first: ContextMenuItemOrSeparator = isDir
        ? isExpanded(row.path)
          ? { type: "item", id: "collapse", label: "Collapse" }
          : { type: "item", id: "expand", label: "Expand" }
        : { type: "item", id: "open", label: "Open" };
      const items: ContextMenuItemOrSeparator[] = [
        first,
        { type: "item", id: "copy", label: "Copy Path" },
        { type: "item", id: "reveal", label: "Reveal in Finder" },
        { type: "item", id: "terminal", label: "Open in Default App" },
        ...edits,
        { type: "separator" },
        { type: "item", id: "refresh", label: "Refresh" },
      ];
      void showContextMenu({ requestId: REQUEST_ID, items });
    },
    [canEdit, isExpanded],
  );
}
