import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitPullRequest, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { useEffect, useState, useTransition, type RefObject } from "react";

import { Panel, PanelGroup, PanelSeparator } from "@/components/ui/panels";
import { PaneHeader } from "@/components/workspace";
import { daemon } from "@/daemon";
import { useTaskPullRequest } from "@/hooks/useTaskPullRequest";
import { cn } from "@/lib/utils";
import type { GitBranchCommit, TaskInfo } from "@/protocol";
import { PANEL_BOUNDS, useAutoHiddenRail, usePanelSize } from "@/store/panelLayout";
import { useUi } from "@/store/ui";

import { ChangesRail } from "../../components/ChangesRail";
import { DiffNotesBar } from "../../components/diffNotes/DiffNotesBar";
import type { EditHunk, FileDiff, HunkResolution, TaskDiff } from "../../protocol";
import type { DiffView } from "../../store/ui";
import { CommitsPanel } from "../push/CommitsPanel";
import { InlinePrPanel } from "../push/InlinePrPanel";
import { branchCommitsKey, useBranchActions } from "../push/useBranchActions";
import { ChangesRailSkeleton } from "./ChangesRailSkeleton";
import { DiffWorkspace, estimateFileHeight, type DiffWorkspaceHandle } from "./DiffWorkspace";
import { FileDiffSkeleton } from "./FileDiffSkeleton";

/** The shell's placeholder while the diff workspace is still unmounted. It is
 *  the same file skeleton the workspace shows per loading file, so the two
 *  loading states share one visual language. */
export function DiffSkeleton({ files }: { files: readonly FileDiff[] }) {
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

function prCreationDisabledReason(branch: string | undefined, base: string | null | undefined) {
  return branch === "main" || branch === "master" || (branch && branch === base)
    ? "Switch to a feature branch to create a pull request"
    : undefined;
}

/**
 * Diff surface: `DiffWorkspace` plus `ChangesRail` side by side. Diff is no
 * longer a tab shared with the file editor; the changes rail is a drag-
 * resizable panel that folds away from its header control.
 */
export function DiffSurface({
  task,
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
  project,
  selected,
  onSelect,
  commitExpanded,
  onCommitExpandedChange,
  onCommitted,
  onRefresh,
  diffWorkspaceRef,
  initialScrollTop,
  onScrollTopChange,
  collapsedFiles,
  onToggleCollapsed,
}: {
  task: TaskInfo;
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
  project: string;
  selected: string | null;
  onSelect: (path: string, hunks?: EditHunk[]) => void;
  commitExpanded: boolean;
  onCommitExpandedChange: (expanded: boolean) => void;
  onCommitted: () => void;
  onRefresh: () => void;
  diffWorkspaceRef: RefObject<DiffWorkspaceHandle | null>;
  /** Saved diff scroll offset, restored once by the workspace. */
  initialScrollTop?: number;
  onScrollTopChange?: (scrollTop: number) => void;
  /** Files folded to their header in this session. */
  collapsedFiles?: ReadonlySet<string>;
  onToggleCollapsed?: (path: string) => void;
}) {
  const taskId = task.id;
  const queryClient = useQueryClient();
  const actions = useBranchActions(task);
  const pr = useTaskPullRequest(taskId);
  const [commit, setCommit] = useState<GitBranchCommit | null>(null);
  const history = useQuery({
    queryKey: ["commitDiff", taskId, commit?.hash],
    queryFn: () => daemon.commitDiff(taskId, commit!.hash),
    enabled: Boolean(commit),
  });
  const shownDiff = commit ? (history.data ?? null) : diff;
  const branch = diff?.branch ?? actions.info?.branch;
  const prCreationReason = prCreationDisabledReason(branch, task.baseBranch);
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
      <PaneHeader
        leading={
          shownDiff ? (
            <span className="tnum text-[11px] text-muted-foreground">
              {shownDiff.files.length} files
            </span>
          ) : undefined
        }
        actions={
          <>
            {commit && (
              <span className="flex min-w-0 max-w-64 items-center gap-1 rounded border border-border px-1.5 py-px text-[11px] text-muted-foreground">
                <span className="shrink-0 font-mono">{commit.shortHash}</span>
                <span className="truncate" title={commit.subject}>
                  {commit.subject}
                </span>
                <button
                  type="button"
                  aria-label="Back to working changes"
                  title="Back to working changes"
                  onClick={() => setCommit(null)}
                  className="shrink-0 rounded p-0.5 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <X aria-hidden className="size-3" />
                </button>
              </span>
            )}
            {!pr && (
              <button
                type="button"
                disabled={Boolean(prCreationReason)}
                title={prCreationReason ?? "Create a pull request"}
                onClick={() => actions.setMode("pr")}
                className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background/30 px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <GitPullRequest aria-hidden className="size-3.5" />
                Create PR
              </button>
            )}
            <div className="flex rounded-md border border-border bg-background/30 p-0.5">
              {(["unified", "split"] as const).map((v) => (
                <button
                  type="button"
                  key={v}
                  onClick={() => onSetDiffView(v)}
                  className={cn(
                    "rounded px-2 py-0.5 text-[13px] capitalize transition-colors",
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
          </>
        }
      />
      <PanelGroup orientation="horizontal" className="min-h-0 min-w-0 flex-1">
        <Panel pin className="min-h-0 min-w-0">
          <DiffNotesBar onJump={(path) => diffWorkspaceRef.current?.scrollToFile(path)} />
          {actions.mode === "pr" ? (
            <InlinePrPanel
              actions={actions}
              taskId={taskId}
              onClose={() => actions.setMode("push")}
            />
          ) : workspaceReady ? (
            <DiffWorkspace
              historical={Boolean(commit)}
              ref={diffWorkspaceRef}
              diff={shownDiff}
              diffError={commit ? (history.error?.message ?? null) : diffError}
              diffView={diffView}
              editable={editable}
              localRes={localRes}
              onOpenFiles={onOpenFiles}
              onResolve={onResolve}
              onSendToChat={onSendToChat}
              taskId={taskId}
              initialScrollTop={initialScrollTop}
              onScrollTopChange={onScrollTopChange}
              collapsedFiles={collapsedFiles}
              onToggleCollapsed={onToggleCollapsed}
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
          // Kept mounted so folding the rail — and every task switch that
          // re-renders this surface — reuses the live `ChangesRail` (its tab,
          // its scroll) instead of rebuilding it and repainting the skeleton.
          keepMounted
          onCollapsedChange={setCollapsed}
          onSizeChange={setSize}
          className="min-w-0"
        >
          {diff ? (
            <ChangesRail
              commitsPanel={
                <CommitsPanel
                  taskId={taskId}
                  selected={commit?.hash ?? null}
                  onSelect={(picked) => {
                    setCommit(picked);
                    actions.setMode("push");
                  }}
                  actions={actions}
                  hasPr={Boolean(pr)}
                  createPrDisabledReason={prCreationReason}
                  onCreatePr={() => actions.setMode("pr")}
                />
              }
              project={project}
              files={diff.files}
              untrackedPaths={diff.untrackedPaths}
              untrackedAvailable={diff.untrackedAvailable}
              selected={selected}
              taskId={taskId}
              commitExpanded={commitExpanded}
              onCommitExpandedChange={onCommitExpandedChange}
              onCommitted={() => {
                void queryClient.invalidateQueries({ queryKey: branchCommitsKey(taskId) });
                void actions.load();
                onCommitted();
              }}
              onRefresh={onRefresh}
              onSelect={onSelect}
              onOpenFile={onOpenFile}
            />
          ) : (
            <ChangesRailSkeleton />
          )}
        </Panel>
      </PanelGroup>
    </div>
  );
}
