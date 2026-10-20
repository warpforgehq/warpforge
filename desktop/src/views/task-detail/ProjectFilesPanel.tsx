import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FileText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonBar, SkeletonBlock, skeletonWidth } from "@/components/ui/skeleton";
import { PaneHeader } from "@/components/workspace";

import { ExplorerRow, type ExplorerRowHandlers } from "./explorer/ExplorerRow";
import { buildVisibleRows, parentFolders, staleExpanded } from "./explorer/explorerRows";
import { startFileDrag } from "./explorer/fileDrag";
import { invalidateExplorer, useExplorerData } from "./explorer/useExplorerData";
import { useExplorerMenu } from "./explorer/useExplorerMenu";
import { FileSystemActionDialog, type FileSystemAction } from "./FileSystemActionDialog";
import { PROJECT_ROW_HEIGHT } from "./projectFileTree";

export interface ProjectTreeState {
  expandedDirs: string[];
  scrollTop: number;
  scrollLeft: number;
  onChange: (next: { expandedDirs: string[]; scrollTop: number; scrollLeft: number }) => void;
}

/**
 * The Explorer: the checkout's tree, read one directory at a time as folders
 * open (ADR 0028), with git status markers joined by path.
 */
export function ProjectFilesPanel({
  selected,
  onSelect,
  taskId,
  project,
  rootPath,
  onRefresh,
  treeState,
  resetKey,
}: {
  selected: string | null;
  onSelect: (path: string) => void;
  taskId?: string;
  project?: string;
  rootPath?: string;
  onRefresh?: () => void;
  /** When provided, expansion and scroll are persisted through the caller's
   *  workspace session instead of living only in component state. */
  treeState?: ProjectTreeState;
  /** Identity of the subject owning the tree; a change re-arms scroll restore. */
  resetKey?: string;
}) {
  const queryClient = useQueryClient();
  const subject = useMemo(() => ({ project, taskId: taskId || undefined }), [project, taskId]);
  const [localOpenFolders, setLocalOpenFolders] = useState<Set<string>>(() => new Set());
  const openFolders = useMemo(
    () => (treeState ? new Set(treeState.expandedDirs) : localOpenFolders),
    [localOpenFolders, treeState],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastRevealedFileRef = useRef<string | null>(null);
  const restoredScrollRef = useRef(false);
  // Keep the latest session-driven state in a ref so the callbacks below stay
  // referentially stable. An unstable callback in the reveal effect's deps
  // re-ran the effect every render and wrote the tree back on a loop.
  const treeStateRef = useRef(treeState);
  treeStateRef.current = treeState;
  const openFoldersRef = useRef(openFolders);
  openFoldersRef.current = openFolders;

  const { listing, status, rootError, rootLoading } = useExplorerData(subject, openFolders);

  const setOpenFolders = useCallback((updater: (previous: Set<string>) => Set<string>) => {
    const state = treeStateRef.current;
    if (!state) {
      setLocalOpenFolders(updater);
      return;
    }
    const next = updater(new Set(state.expandedDirs));
    const nextDirs = [...next];
    if (
      nextDirs.length === state.expandedDirs.length &&
      nextDirs.every((dir) => state.expandedDirs.includes(dir))
    ) {
      return;
    }
    state.onChange({
      expandedDirs: nextDirs,
      scrollLeft: state.scrollLeft,
      scrollTop: state.scrollTop,
    });
  }, []);

  const rows = useMemo(
    () => buildVisibleRows(listing, openFolders, status, true),
    [listing, openFolders, status],
  );

  // Deeply nested trees push file names off the panel's fixed width. Give the
  // scroll content a width derived from the deepest visible row's indent so the
  // panel scrolls horizontally and no label is clipped.
  const contentWidth = useMemo(() => {
    const maxDepth = rows.reduce((m, r) => Math.max(m, r.depth), 0);
    return Math.max(240, maxDepth * 12 + 10 + 240);
  }, [rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => PROJECT_ROW_HEIGHT,
    getScrollElement: () => scrollRef.current,
    overscan: 20,
  });

  useEffect(() => {
    if (!selected) return;
    const parents = parentFolders(selected);
    if (parents.length === 0) return;
    setOpenFolders((previous) => {
      const next = new Set(previous);
      let changed = false;
      for (const folder of parents) {
        if (!next.has(folder)) {
          next.add(folder);
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [selected, setOpenFolders]);

  useEffect(() => {
    if (!selected || lastRevealedFileRef.current === selected) {
      return;
    }
    const index = rows.findIndex((row) => row.path === selected);
    if (index < 0) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(index, { align: "auto" });
      lastRevealedFileRef.current = selected;
    });
    return () => cancelAnimationFrame(frame);
  }, [rows, selected, virtualizer]);

  // Restore the tree's scroll once per subject, then keep the session current
  // from the scroll handler. The panel stays mounted across a project switch,
  // so `resetKey` re-arms the one-shot restore.
  useEffect(() => {
    restoredScrollRef.current = false;
  }, [resetKey]);

  // Expanded folders a loaded listing no longer has are dropped, so a renamed
  // or deleted directory cannot keep its entry in the session.
  useEffect(() => {
    const stale = staleExpanded(openFoldersRef.current, listing);
    if (stale.length === 0) return;
    setOpenFolders((previous) => {
      const next = new Set(previous);
      for (const dir of stale) next.delete(dir);
      return next;
    });
  }, [listing, setOpenFolders]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !treeState || restoredScrollRef.current) return;
    restoredScrollRef.current = true;
    element.scrollTop = treeState.scrollTop;
    element.scrollLeft = treeState.scrollLeft;
  }, [treeState]);

  const onTreeScroll = useCallback(() => {
    const element = scrollRef.current;
    const state = treeStateRef.current;
    if (!element || !state) return;
    state.onChange({
      expandedDirs: state.expandedDirs,
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
    });
  }, []);

  const toggleFolder = useCallback(
    (dir: string) => {
      setOpenFolders((prev) => {
        const next = new Set(prev);
        if (next.has(dir)) {
          next.delete(dir);
        } else {
          next.add(dir);
        }
        return next;
      });
    },
    [setOpenFolders],
  );
  const isExpanded = useCallback((dir: string) => openFoldersRef.current.has(dir), []);

  const refresh = useCallback(() => {
    invalidateExplorer(queryClient, subject);
    onRefresh?.();
  }, [onRefresh, queryClient, subject]);

  const [fileAction, setFileAction] = useState<FileSystemAction | null>(null);
  const onRowContextMenu = useExplorerMenu({
    canEdit: Boolean(taskId || project),
    isExpanded,
    onFileAction: setFileAction,
    onOpen: onSelect,
    onRefresh: refresh,
    onToggle: toggleFolder,
    rootPath,
  });

  const handlers = useMemo<ExplorerRowHandlers>(
    () => ({
      onActivate: (_event, row) => {
        if (row.kind === "dir") toggleFolder(row.path);
        else onSelect(row.path);
      },
      onContextMenu: onRowContextMenu,
      onDragStart: (event, row) => startFileDrag(event, row.path),
    }),
    [onRowContextMenu, onSelect, toggleFolder],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader title="Project Files" />
      {rootError && <p className="border-b px-3 py-2 text-xs text-destructive">{rootError}</p>}
      <div
        ref={scrollRef}
        onScroll={onTreeScroll}
        className="min-h-0 flex-1 overflow-auto overflow-x-auto py-1.5"
      >
        {rows.length === 0 && !rootError ? (
          rootLoading ? (
            <SkeletonBlock
              aria-label="Loading project files"
              data-testid="project-files-skeleton"
              className="space-y-2.5 px-3 py-2"
            >
              {Array.from({ length: 8 }, (_, row) => (
                <div key={row} className="flex h-4 items-center gap-2">
                  <SkeletonBar className="size-3.5 shrink-0" />
                  <SkeletonBar h={10} w={skeletonWidth(row, 0, 30, 70)} />
                </div>
              ))}
            </SkeletonBlock>
          ) : (
            <EmptyState compact icon={FileText} title="No files found" />
          )
        ) : (
          <div
            className="relative"
            style={{ height: virtualizer.getTotalSize(), width: contentWidth }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              return (
                <ExplorerRow
                  key={row.path}
                  row={row}
                  selected={row.kind === "file" && selected === row.path}
                  top={vi.start}
                  handlers={handlers}
                />
              );
            })}
          </div>
        )}
      </div>
      <FileSystemActionDialog
        action={fileAction}
        taskId={taskId ?? ""}
        project={project}
        onComplete={refresh}
        onClose={() => setFileAction(null)}
      />
    </div>
  );
}
