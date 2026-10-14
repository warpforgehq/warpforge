import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Download,
  GitBranch,
  GitCommitVertical,
  GitMerge,
  Loader2,
  Plus,
  Search,
  Send,
} from "lucide-react";
import { useEffect, useCallback, useMemo, useRef, useState } from "react";

import { daemon } from "../../daemon";
import type { GitBranchList, GitOpResult, TaskInfo } from "../../protocol";
import { daemonQuery } from "../../query";
import { useUi } from "../../store/ui";
import { BranchActionsDialog, type BranchAction } from "./BranchActionsDialog";
import { holdersByBranch } from "./branchCheckout";
import { BranchList } from "./BranchList";
import {
  buildBranchTree,
  defaultOpenFolders,
  flattenBranchTree,
  type BranchRow,
} from "./branchTree";
import { GitMenuAction, handleGitOpError, handleGitOpResult, invalidateAll } from "./gitMenu";
import { MergeWorktreeDialog } from "./MergeWorktreeDialog";
import { useBranchMenu } from "./useBranchMenu";

export function GitWorkspaceControls({
  taskId,
  branch,
  task,
  onOpenCommit,
  onOpenPush,
}: {
  taskId: string;
  branch: string | null;
  /** The open task, when it has one — used to offer the worktree merge. */
  task?: TaskInfo;
  onOpenCommit: () => void;
  onOpenPush: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const repositoryOperation = useUi((s) => s.repositoryOperation);
  const setRepositoryOperation = useUi((s) => s.setRepositoryOperation);

  const branchesQuery = useQuery({
    enabled: open,
    queryFn: daemonQuery<GitBranchList>("git.branches", { task_id: taskId }),
    queryKey: ["branches", taskId],
  });
  const branchData = branchesQuery.data;
  const branches = useMemo(() => branchData?.branches ?? [], [branchData]);
  const normalizedSearch = search.trim().toLowerCase();
  const showSync =
    !normalizedSearch || "sync with remote update project".includes(normalizedSearch);
  const showCommit = !normalizedSearch || "commit changes".includes(normalizedSearch);
  const showPush = !normalizedSearch || "push changes".includes(normalizedSearch);
  const showNewBranch = !normalizedSearch || "new branch".includes(normalizedSearch);
  const canMergeWorktree = Boolean(task?.worktree && task?.baseBranch);
  const showMerge =
    canMergeWorktree &&
    (!normalizedSearch || "merge worktree into base".includes(normalizedSearch));

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !menuRef.current?.contains(target) &&
        !(target instanceof Element && target.closest("[data-radix-popper-content-wrapper]"))
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  const updateMut = useMutation({
    mutationFn: () => daemon.request("git.update", { task_id: taskId }) as Promise<GitOpResult>,
    onMutate: () => setRepositoryOperation({ kind: "pull", taskId }),
    onError: (e: Error) => handleGitOpError(e),
    onSettled: () => {
      const operation = useUi.getState().repositoryOperation;
      if (operation?.taskId === taskId && operation.kind === "pull") {
        setRepositoryOperation(null);
      }
    },
    onSuccess: (r) => {
      handleGitOpResult(r);
      invalidateAll(queryClient, taskId);
    },
  });
  const switchMut = useMutation({
    mutationFn: (target: string) =>
      daemon.request("git.switchBranch", {
        task_id: taskId,
        branch: target,
      }) as Promise<GitOpResult>,
    onError: (e: Error) => handleGitOpError(e),
    onSuccess: (r) => {
      handleGitOpResult(r);
      invalidateAll(queryClient, taskId);
    },
  });

  const updating =
    updateMut.isPending ||
    (repositoryOperation?.taskId === taskId && repositoryOperation.kind === "pull");
  const switching = switchMut.isPending ? switchMut.variables : null;
  const busy = Boolean(repositoryOperation) || updating || switchMut.isPending;

  const [action, setAction] = useState<BranchAction | null>(null);

  const remoteBranches = useMemo(() => branchData?.remotes ?? [], [branchData]);
  const holders = useMemo(() => holdersByBranch(branchData?.worktrees), [branchData]);

  const openActionDialog = (a: BranchAction) => {
    setOpen(false);
    setAction(a);
  };

  const switchTo = (target: string) => {
    setOpen(false);
    if (busy || target === branch) {
      return;
    }
    switchMut.mutate(target);
  };

  const handleBranchAction = useBranchMenu({
    branch,
    holders,
    close: () => setOpen(false),
    openActionDialog,
    switchTo,
    update: () => updateMut.mutate(),
    openPush: onOpenPush,
    openMerge: () => setMergeOpen(true),
  });

  const localTree = useMemo(() => buildBranchTree(branches), [branches]);
  const remoteTree = useMemo(() => buildBranchTree(remoteBranches), [remoteBranches]);
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set());
  const toggleFolder = useCallback((key: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  useEffect(() => {
    if (open && openFolders.size === 0) {
      setOpenFolders((prev) => {
        const next = new Set([
          ...prev,
          ...defaultOpenFolders(localTree),
          ...defaultOpenFolders(remoteTree),
        ]);
        return next.size === prev.size ? prev : next;
      });
    }
  }, [open, openFolders.size, localTree, remoteTree]);
  const localRows = useMemo(() => {
    const out: BranchRow[] = [];
    flattenBranchTree(localTree, 0, "", openFolders, out);
    return out;
  }, [localTree, openFolders]);
  const remoteRows = useMemo(() => {
    const out: BranchRow[] = [];
    flattenBranchTree(remoteTree, 0, "", openFolders, out);
    return out;
  }, [remoteTree, openFolders]);

  const filteredLocal = useMemo(
    () =>
      normalizedSearch
        ? branches.filter((item) => item.toLowerCase().includes(normalizedSearch))
        : [],
    [branches, normalizedSearch],
  );
  const filteredRemote = useMemo(
    () =>
      normalizedSearch
        ? remoteBranches.filter((item) => item.toLowerCase().includes(normalizedSearch))
        : [],
    [remoteBranches, normalizedSearch],
  );
  const searching = normalizedSearch.length > 0;
  const searchRows = useMemo(() => {
    if (!searching) return [];
    const out: BranchRow[] = [];
    for (const b of filteredLocal) {
      out.push({ key: b, depth: 0, label: b.split("/").pop()!, branch: b });
    }
    for (const b of filteredRemote) {
      out.push({ key: b, depth: 0, label: b.split("/").pop()!, branch: b, remote: true });
    }
    return out;
  }, [searching, filteredLocal, filteredRemote]);

  return (
    <span className="flex min-w-0 items-center">
      <div ref={menuRef} className="relative min-w-0">
        <button
          type="button"
          disabled={!branch}
          onClick={() => setOpen((o) => !o)}
          title="Branches and Git actions"
          className="flex items-center gap-1 rounded px-1 hover:bg-secondary hover:text-foreground disabled:opacity-60"
        >
          <GitBranch className="size-3 shrink-0" />
          <span className="max-w-40 truncate">{branch ?? "no-branch"}</span>
          {switching ? (
            <Loader2 className="size-2.5 animate-spin opacity-60" />
          ) : (
            branch && <ChevronDown className="size-2.5 opacity-60" />
          )}
        </button>
        {open && branch && (
          <div className="absolute bottom-full right-0 z-50 mb-1 flex max-h-[min(520px,calc(100vh-4rem))] w-[min(420px,calc(100vw-1rem))] flex-col overflow-hidden rounded-md border border-border bg-popover shadow-xl">
            <div className="shrink-0 border-b p-2">
              <label className="flex h-8 items-center gap-2 rounded-md border border-input bg-background/60 px-2 focus-within:ring-1 focus-within:ring-ring">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setOpen(false);
                  }}
                  placeholder="Search branches and actions"
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
                />
              </label>
            </div>
            <div className="min-h-0 overflow-y-auto p-1.5">
              {(showNewBranch || showSync || showCommit || showPush || showMerge) && (
                <div className="space-y-0.5 pb-1.5">
                  {showNewBranch && (
                    <GitMenuAction
                      icon={<Plus className="size-3.5" />}
                      label="New Branch…"
                      shortcut="⌥⌘N"
                      disabled={busy || !branch}
                      onClick={() => openActionDialog({ kind: "create", from: branch })}
                    />
                  )}
                  {showSync && (
                    <GitMenuAction
                      icon={
                        updating ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Download className="size-3.5" />
                        )
                      }
                      label="Sync with remote"
                      shortcut="⌘T"
                      disabled={busy || !branch}
                      onClick={() => updateMut.mutate()}
                    />
                  )}
                  {showCommit && (
                    <GitMenuAction
                      icon={<GitCommitVertical className="size-3.5" />}
                      label="Commit…"
                      shortcut="⌘K"
                      onClick={() => {
                        setOpen(false);
                        onOpenCommit();
                      }}
                    />
                  )}
                  {showPush && (
                    <GitMenuAction
                      icon={<Send className="size-3.5" />}
                      label="Push…"
                      shortcut="⇧⌘K"
                      onClick={() => {
                        setOpen(false);
                        onOpenPush();
                      }}
                    />
                  )}
                  {showMerge && (
                    <GitMenuAction
                      icon={<GitMerge className="size-3.5" />}
                      label={`Merge into ${task?.baseBranch}…`}
                      shortcut=""
                      disabled={busy}
                      onClick={() => {
                        setOpen(false);
                        setMergeOpen(true);
                      }}
                    />
                  )}
                </div>
              )}

              {(showNewBranch || showSync || showCommit || showPush || showMerge) && (
                <div className="mx-1 border-t" />
              )}
              {!branchesQuery.isLoading && (
                <BranchList
                  localRows={localRows}
                  remoteRows={remoteRows}
                  searching={searching}
                  searchRows={searchRows}
                  openFolders={openFolders}
                  current={branch}
                  holders={holders}
                  onAction={handleBranchAction}
                  onToggleFolder={toggleFolder}
                />
              )}
              {!branchesQuery.isLoading && searching && searchRows.length === 0 && (
                <p className="px-2 py-1.5 text-[13px] text-muted-foreground">
                  No matching branches
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      <BranchActionsDialog
        action={action}
        branches={branches}
        current={branch ?? ""}
        remotes={remoteBranches}
        taskId={taskId}
        onComplete={() => invalidateAll(queryClient, taskId)}
        onClose={() => setAction(null)}
      />
      {task && (
        <MergeWorktreeDialog
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          task={task}
          onMerged={() => invalidateAll(queryClient, taskId)}
        />
      )}
    </span>
  );
}
