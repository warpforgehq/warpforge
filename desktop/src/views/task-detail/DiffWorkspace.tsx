import { useVirtualizer } from "@tanstack/react-virtual";
import { FileText } from "lucide-react";
import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";

import { daemon } from "../../daemon";
import type { EditHunk, FileDiff, HunkResolution, TaskDiff } from "../../protocol";
import { fileAnchor, hunkKey } from "./diffAnchors";
import { matchingHunkIndexes } from "./editHunkMatch";
import { DiffSkeleton } from "./DiffSurface";
import { EditorSkeleton } from "./EditorSkeleton";
import { FileDiffSkeleton } from "./FileDiffSkeleton";
import { useSplitFileQueries } from "./useTaskQueries";

const MergeDiff = lazy(async () => ({
  default: (await import("../../components/MergeDiff")).MergeDiff,
}));
const UnifiedDiff = lazy(async () => ({
  default: (await import("../../components/UnifiedDiff")).UnifiedDiff,
}));
const EMPTY_DIFF_FILES: FileDiff[] = [];

/**
 * A file's rendered height, from its own line counts — the last hunk's reach
 * into the new file, since the CodeMirror editor inside renders the whole
 * document (its own viewport virtualizes, the spacer stays full-height).
 *
 * The fixed 384px estimate this replaces was fine for small diffs and poison
 * for big ones: a 10k-line file is ~200kpx, so `measureElement` kept
 * rewriting every position below it while scrolling, and the whole list
 * lurched. A close estimate means measurement confirms instead of corrects.
 */
export function estimateFileHeight(file: FileDiff | undefined): number {
  const HEADER_PX = 36;
  const LINE_PX = 20;
  if (!file) return 384;
  let lastLine = 0;
  for (const hunk of file.hunks) {
    lastLine = Math.max(lastLine, hunk.newStart + hunk.newLines);
  }
  return HEADER_PX + Math.max(lastLine, 8) * LINE_PX;
}

function EmptyChangesState({ onOpenFiles }: { onOpenFiles: () => void }) {
  return (
    <div className="flex h-full min-h-56 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="rounded-full border border-border/70 bg-secondary/40 p-3 text-muted-foreground">
        <FileText className="size-5" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">No file changes yet</p>
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
          Continue the conversation, or open a project file while the agent is working.
        </p>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={onOpenFiles}>
        <FileText className="size-3.5" />
        Open files
      </Button>
    </div>
  );
}

export interface DiffWorkspaceHandle {
  /** Scrolls to a file's diff. Returns false while the diff does not carry
   *  the path yet — the caller retries rather than dropping the request. */
  scrollToFile: (path: string, editHunks?: EditHunk[]) => boolean;
  /** Scrolls to a semantic hunk key inside a file's diff. Returns false when
   *  the file or the hunk is no longer present. */
  scrollToHunk: (path: string, hunkKey: string) => boolean;
}

interface Props {
  diff: TaskDiff | null;
  diffError: string | null;
  diffView: "unified" | "split";
  editable: boolean;
  localRes: Record<string, HunkResolution>;
  onOpenFiles: () => void;
  onResolve: (file: string, hunkIndex: number, resolution: HunkResolution) => void;
  onSendToChat: (file: FileDiff) => void;
  taskId: string;
  /** Saved scroll offset, applied once when the workspace mounts. */
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  /** Files whose diff body is collapsed in this session. */
  collapsedFiles?: ReadonlySet<string>;
  onToggleCollapsed?: (path: string) => void;
}

export const DiffWorkspace = forwardRef<DiffWorkspaceHandle, Props>(function DiffWorkspace(
  {
    diff,
    diffError,
    diffView,
    editable,
    localRes: _localRes,
    onOpenFiles,
    onResolve: _onResolve,
    onSendToChat,
    taskId,
    initialScrollTop,
    onScrollTopChange,
    collapsedFiles,
    onToggleCollapsed,
  },
  ref,
) {
  const unifiedScrollParent = useRef<HTMLDivElement>(null);
  const splitScrollParent = useRef<HTMLDivElement>(null);
  const restoredScrollRef = useRef(false);
  const [splitRange, setSplitRange] = useState({ start: 0, end: -1 });
  const [unifiedRange, setUnifiedRange] = useState({ start: 0, end: -1 });
  // kept for scrollToFile hunk-highlight; unified CM does not render it yet
  const [_highlightedEdit, setHighlightedEdit] = useState<{
    path: string;
    hunks: ReadonlySet<number>;
  } | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const files = diff?.files ?? EMPTY_DIFF_FILES;

  // Overscan 2, not 1: `scrollToFile` targets a file that may be off screen,
  // and the editor inside it cannot report its hunk position until it is
  // mounted. One row of slack left the target unmounted exactly when it was
  // being scrolled to.
  const unifiedVirtualizer = useVirtualizer({
    count: files.length,
    estimateSize: (index) => estimateFileHeight(files[index]),
    getScrollElement: () => unifiedScrollParent.current,
    overscan: 2,
  });
  const splitVirtualizer = useVirtualizer({
    count: files.length,
    estimateSize: (index) => estimateFileHeight(files[index]),
    getScrollElement: () => splitScrollParent.current,
    overscan: 1,
  });
  const unifiedItems = unifiedVirtualizer.getVirtualItems();
  const splitItems = splitVirtualizer.getVirtualItems();
  const splitVisibleStart = splitItems[0]?.index;
  const splitVisibleEnd = splitItems[splitItems.length - 1]?.index;
  const unifiedVisibleStart = unifiedItems[0]?.index;
  const unifiedVisibleEnd = unifiedItems[unifiedItems.length - 1]?.index;

  useEffect(() => {
    if (splitVisibleStart === undefined || splitVisibleEnd === undefined) return;
    setSplitRange((current) =>
      current.start === splitVisibleStart && current.end === splitVisibleEnd
        ? current
        : { end: splitVisibleEnd, start: splitVisibleStart },
    );
  }, [splitVisibleEnd, splitVisibleStart]);

  useEffect(() => {
    if (unifiedVisibleStart === undefined || unifiedVisibleEnd === undefined) return;
    setUnifiedRange((current) =>
      current.start === unifiedVisibleStart && current.end === unifiedVisibleEnd
        ? current
        : { end: unifiedVisibleEnd, start: unifiedVisibleStart },
    );
  }, [unifiedVisibleEnd, unifiedVisibleStart]);

  useEffect(() => {
    if (restoredScrollRef.current) return;
    restoredScrollRef.current = true;
    if (!initialScrollTop) return;
    const container =
      diffView === "unified" ? unifiedScrollParent.current : splitScrollParent.current;
    if (container) container.scrollTop = initialScrollTop;
  }, [diffView, initialScrollTop]);

  // Folding a file changes its row height; the cached measurement would leave
  // the rows below it spaced for the expanded body.
  useEffect(() => {
    unifiedVirtualizer.measure();
    splitVirtualizer.measure();
  }, [collapsedFiles, splitVirtualizer, unifiedVirtualizer]);

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      onScrollTopChange?.(event.currentTarget.scrollTop);
    },
    [onScrollTopChange],
  );

  const splitFileQueries = useSplitFileQueries(taskId, files, diffView === "split", splitRange);
  const unifiedFileQueries = useSplitFileQueries(
    taskId,
    files,
    diffView === "unified",
    unifiedRange,
  );

  useEffect(
    () => () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    },
    [],
  );

  /** Start the fade only once the editor reports the hunk is on screen. */
  const armHighlightFade = useCallback(() => {
    if (highlightTimerRef.current !== null) return;
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedEdit(null);
      highlightTimerRef.current = null;
    }, 2400);
  }, []);

  /** Scroll to one file row, highlighting matched hunks (indexes). */
  const scrollToFileIndex = useCallback(
    (index: number, path: string, matchingHunks: number[]): boolean => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
      // No timer here. The editor that consumes this is lazy-loaded and waits
      // on its own document fetch, so on a cold open it can mount well after
      // the request — a fixed 2.4s window expired first and the request
      // arrived as `undefined`, which is why the diff opened at the top of
      // the file instead of at the change. The fade is armed by
      // `onScrolledToHunk`, once the scroll has actually happened.
      setHighlightedEdit(
        matchingHunks.length > 0 ? { hunks: new Set(matchingHunks), path } : null,
      );
      const container =
        diffView === "unified" ? unifiedScrollParent.current : splitScrollParent.current;
      const virtualizer = diffView === "unified" ? unifiedVirtualizer : splitVirtualizer;
      virtualizer.scrollToIndex(index, { align: "start" });
      // In unified mode the editor scrolls to the hunk itself via the
      // highlighted-hunks decoration; here we only ensure the file is on
      // screen (the file-level anchor still exists in the virtualized list).
      if (diffView === "unified") return true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const anchorEl = document.getElementById(fileAnchor(path));
          // Scroll only the virtualized list's own container. Native
          // Element.scrollIntoView() walks every scrollable ancestor
          // (including ones with overflow: hidden), which can drag
          // unrelated chrome like the surface tabs or app sidebar with it.
          if (container && anchorEl) {
            const offset =
              anchorEl.getBoundingClientRect().top -
              container.getBoundingClientRect().top +
              container.scrollTop;
            container.scrollTo({ behavior: "smooth", top: offset });
          }
        });
      });
      return true;
    },
    [diffView, splitVirtualizer, unifiedVirtualizer],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToFile(path, editHunks = []) {
        const index = files.findIndex((file) => file.path === path);
        if (index < 0) return false;
        const matchingHunks =
          editHunks.length > 0 ? matchingHunkIndexes(files[index].hunks, editHunks) : [];
        return scrollToFileIndex(index, path, matchingHunks);
      },
      scrollToHunk(path, key) {
        const index = files.findIndex((file) => file.path === path);
        if (index < 0) return false;
        const hunkIndex = files[index].hunks.findIndex((hunk) => hunkKey(hunk) === key);
        if (hunkIndex < 0) return false;
        return scrollToFileIndex(index, path, [hunkIndex]);
      },
    }),
    [files, scrollToFileIndex],
  );

  if (diffView === "unified") {
    return (
      <div ref={unifiedScrollParent} onScroll={handleScroll} className="min-h-0 flex-1 overflow-auto">
        {diffError && <p className="p-3 text-sm text-destructive">{diffError}</p>}
        {!diff && !diffError && <DiffSkeleton files={[]} />}
        {diff && files.length === 0 && <EmptyChangesState onOpenFiles={onOpenFiles} />}
        {diff && files.length > 0 && (
          <div className="relative w-full" style={{ height: unifiedVirtualizer.getTotalSize() }}>
            {unifiedItems.map((item) => {
              const file = files[item.index];
              const query = unifiedFileQueries[item.index];
              const doc = query?.data;
              return (
                <div
                  key={item.key}
                  id={fileAnchor(file.path)}
                  data-index={item.index}
                  ref={unifiedVirtualizer.measureElement}
                  className="absolute left-0 top-0 w-full border-b"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {doc ? (
                    <Suspense fallback={<EditorSkeleton height={estimateFileHeight(file)} />}>
                      <UnifiedDiff
                        key={`${doc.path}:${editable}`}
                        doc={doc}
                        file={file}
                        editable={editable}
                        collapsed={collapsedFiles?.has(file.path) ?? false}
                        onToggleCollapsed={
                          onToggleCollapsed ? () => onToggleCollapsed(file.path) : undefined
                        }
                        highlightedHunks={
                          _highlightedEdit?.path === file.path ? _highlightedEdit.hunks : undefined
                        }
                        onScrolledToHunk={armHighlightFade}
                        onSave={(content) =>
                          void daemon.request("file.save", {
                            content,
                            path: doc.path,
                            task_id: taskId,
                          })
                        }
                        onSendToChat={onSendToChat}
                      />
                    </Suspense>
                  ) : query?.error ? (
                    <p className="p-3 text-sm text-destructive">
                      Failed to load {file.path}: {query.error.message}
                    </p>
                  ) : (
                    <FileDiffSkeleton
                      file={file}
                      height={estimateFileHeight(file)}
                      index={item.index}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={splitScrollParent} onScroll={handleScroll} className="min-h-0 flex-1 overflow-auto">
      {!diff ? (
        <DiffSkeleton files={[]} />
      ) : files.length === 0 ? (
        <EmptyChangesState onOpenFiles={onOpenFiles} />
      ) : (
        <div className="relative w-full" style={{ height: splitVirtualizer.getTotalSize() }}>
          {splitItems.map((item) => {
            const file = files[item.index];
            const query = splitFileQueries[item.index];
            const doc = query?.data;
            return (
              <div
                key={item.key}
                id={fileAnchor(file.path)}
                data-index={item.index}
                ref={splitVirtualizer.measureElement}
                className="absolute left-0 top-0 w-full border-b"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {doc ? (
                  <Suspense fallback={<EditorSkeleton height={estimateFileHeight(file)} />}>
                    <MergeDiff
                      key={`${doc.path}:${editable}`}
                      doc={doc}
                      file={file}
                      editable={editable}
                      collapsed={collapsedFiles?.has(file.path) ?? false}
                      onToggleCollapsed={
                        onToggleCollapsed ? () => onToggleCollapsed(file.path) : undefined
                      }
                      onSave={(content) =>
                        void daemon.request("file.save", {
                          content,
                          path: doc.path,
                          task_id: taskId,
                        })
                      }
                      onSendToChat={onSendToChat}
                    />
                  </Suspense>
                ) : query?.error ? (
                  <p className="p-3 text-sm text-destructive">
                    Failed to load {file.path}: {query.error.message}
                  </p>
                ) : (
                  <FileDiffSkeleton
                    file={file}
                    height={estimateFileHeight(file)}
                    index={item.index}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
