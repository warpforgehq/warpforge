import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect, useState, useTransition, type RefObject } from "react";

import { Panel, PanelGroup, PanelSeparator } from "@/components/ui/panels";
import { cn } from "@/lib/utils";
import { PANEL_BOUNDS, useAutoHiddenRail, usePanelSize } from "@/store/panelLayout";
import { useUi } from "@/store/ui";

import { ChangesRail } from "../../components/ChangesRail";
import type { EditHunk, FileDiff, HunkResolution, TaskDiff } from "../../protocol";
import type { DiffView } from "../../store/ui";
import { DiffWorkspace, estimateFileHeight, type DiffWorkspaceHandle } from "./DiffWorkspace";
import { FileDiffSkeleton } from "./FileDiffSkeleton";

/** The shell's placeholder while the diff workspace is still unmounted. It is
 *  the same file skeleton the workspace shows per loading file, so the two
 *  loading states share one visual language. */
function DiffSkeleton({ files }: { files: readonly FileDiff[] }) {
  const shown = files.slice(0, 6);
  return (
    <div
      aria-busy
      data-testid="diff-skeleton"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {(shown.length > 0 ? shown : [undefined, undefined, undefined]).map((file, index) => (
        <FileDiffSkeleton
          key={file?.path ?? index}
          file={file}
          height={Math.min(estimateFileHeight(file), 520)}
          index={index}
        />
      ))}
    </div>
  );
}

/**
 * Diff surface: `DiffWorkspace` plus `ChangesRail` side by side. Diff is no
 * longer a tab shared with the file editor; the changes rail is a drag-
 * resizable panel that folds away from its header control.
 */
export function DiffSurface({
  diff,
  diffError,
  diffView,
  editable,
  localRes,
  onOpenFiles,
  onOpenFile,
  onResolve,
  onSendToChat,
  onSetDiffView,
  taskId,
  project,
  selected,
  onSelect,
  commitExpanded,
  onCommitExpandedChange,
  onCommitted,
  onRefresh,
  diffWorkspaceRef,
}: {
  diff: TaskDiff | null;
  diffError: string | null;
  diffView: DiffView;
  editable: boolean;
  localRes: Record<string, HunkResolution>;
  onOpenFiles: () => void;
  /** Open a file for reading (ignored files have no diff to show). */
  onOpenFile: (path: string) => void;
  onResolve: (file: string, hunkIndex: number, resolution: HunkResolution) => void;
  onSendToChat: (file: FileDiff) => void;
  onSetDiffView: (v: DiffView) => void;
  taskId: string;
  project: string;
  selected: string | null;
  onSelect: (path: string, hunks?: EditHunk[]) => void;
  commitExpanded: boolean;
  onCommitExpandedChange: (expanded: boolean) => void;
  onCommitted: () => void;
  onRefresh: () => void;
  diffWorkspaceRef: RefObject<DiffWorkspaceHandle | null>;
}) {
  const collapsed = useUi((s) => s.diffPanelCollapsed);
  const setCollapsed = useUi((s) => s.setDiffPanelCollapsed);
  const toggleCollapsed = useUi((s) => s.toggleDiffPanelCollapsed);
  const [size, setSize] = usePanelSize("diff");
  const bounds = PANEL_BOUNDS.diff;
  const surfaceRef = useAutoHiddenRail(size, setCollapsed);
  // The workspace mounts one frame behind the shell. A restored task arrives
  // with its diff already cached, and mounting the diff's editors in the same
  // commit as the TaskDetail shell is what made the Inbox → Tasks switch freeze
  // before anything painted. The transition keeps the skeleton on screen and
  // lets React yield between the mount's render passes.
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [, startTransition] = useTransition();
  useEffect(() => {
    const frame = requestAnimationFrame(() => startTransition(() => setWorkspaceReady(true)));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div ref={surfaceRef} className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 items-center gap-2 border-b border-rule bg-background/25 px-2">
        {diff && (
          <span className="tnum text-xs text-muted-foreground">{diff.files.length} files</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-md border border-border/80 bg-background/30 p-0.5">
            {(["unified", "split"] as const).map((v) => (
              <button
                type="button"
                key={v}
                onClick={() => onSetDiffView(v)}
                className={cn(
                  "rounded px-2 py-0.5 text-xs capitalize transition-colors",
                  diffView === v
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label={collapsed ? "Expand changes panel" : "Collapse changes panel"}
            title={collapsed ? "Expand changes panel" : "Collapse changes panel"}
            onClick={toggleCollapsed}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            {collapsed ? (
              <PanelRightOpen className="size-4" />
            ) : (
              <PanelRightClose className="size-4" />
            )}
          </button>
        </div>
      </div>
      <PanelGroup orientation="horizontal" className="min-h-0 min-w-0 flex-1">
        <Panel pin className="min-h-0 min-w-0">
          {workspaceReady ? (
            <DiffWorkspace
              ref={diffWorkspaceRef}
              diff={diff}
              diffError={diffError}
              diffView={diffView}
              editable={editable}
              localRes={localRes}
              onOpenFiles={onOpenFiles}
              onResolve={onResolve}
              onSendToChat={onSendToChat}
              taskId={taskId}
            />
          ) : (
            <DiffSkeleton files={diff?.files ?? []} />
          )}
        </Panel>
        <PanelSeparator aria-label="Resize changes panel" />
        <Panel
          size={size}
          minSize={bounds.min}
          maxSize={bounds.max}
          defaultSize={bounds.default}
          collapsed={collapsed}
          keepMounted={false}
          onCollapsedChange={setCollapsed}
          onSizeChange={setSize}
          className="min-w-0"
        >
          {diff ? (
            <ChangesRail
              project={project}
              files={diff.files}
              untrackedPaths={diff.untrackedPaths}
              untrackedAvailable={diff.untrackedAvailable}
              selected={selected}
              taskId={taskId}
              commitExpanded={commitExpanded}
              onCommitExpandedChange={onCommitExpandedChange}
              onCommitted={onCommitted}
              onRefresh={onRefresh}
              onSelect={onSelect}
              onOpenFile={onOpenFile}
            />
          ) : (
            <p className="p-3 text-sm text-muted-foreground">Loading changes…</p>
          )}
        </Panel>
      </PanelGroup>
    </div>
  );
}
