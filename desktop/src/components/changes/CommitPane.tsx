import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Archive,
  Eye,
  EyeOff,
  FolderTree,
  FoldVertical,
  RefreshCw,
  Undo2,
  UnfoldVertical,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { useUi } from "@/store/ui";

import { daemon } from "../../daemon";
import { showContextMenu, useNativeContextMenu } from "../../hooks/useNativeContextMenu";
import type { FileDiff, GitIgnoredFiles, GitRoots } from "../../protocol";
import { daemonQuery } from "../../query";
import { buildChangesRoot, ignoredSectionState } from "./changesTree";
import { CommitBox } from "./CommitBox";
import { FileTreeRow } from "./FileTreeRow";
import { IgnoredFiles } from "./IgnoredFiles";
import { reportGitFailure } from "./reportGitFailure";
import { collectFolderKeys, flattenNode, type FlatRow } from "./treeUtils";
import { useChangesContextMenu } from "./useChangesContextMenu";

/**
 * The Commit tab of the Changes rail: changed files grouped into "Changes"
 * and "Unversioned Files" (once per git root when a project holds several),
 * with per-file and per-folder staging checkboxes, +adds/-dels counts, an
 * ignored files toggle, and an inline commit box. Clicking a file selects it
 * in the diff view.
 *
 * Performance: the tree is flattened into a virtual list — only visible rows
 * are mounted in the DOM, so 900+ files render without jank.
 */

const ROW_HEIGHT = 28;

export function CommitPane({
  project,
  files,
  untrackedPaths,
  untrackedAvailable,
  selected,
  onSelect,
  taskId,
  onOpenFile,
  onShelveRequest,
  onStashRequest,
  commitExpanded: controlledCommitExpanded,
  onCommitExpandedChange,
  onCommitted,
  onRefresh,
}: {
  project: string;
  files: FileDiff[];
  /** Paths within `files` that git does not track yet. */
  untrackedPaths: string[];
  /** False when the untracked scan could not complete — the rail says so
   * instead of implying the project has no unversioned files. */
  untrackedAvailable: boolean;
  selected: string | null;
  onSelect: (path: string) => void;
  taskId: string;
  /** Open an ignored file for reading (it has no diff). Falls back to
   * `onSelect` when absent. */
  onOpenFile?: (path: string) => void;
  /** Open the Shelve dialog for these paths. */
  onShelveRequest: (paths: string[]) => void;
  /** Open the Stash dialog for these paths. */
  onStashRequest: (paths: string[]) => void;
  commitExpanded?: boolean;
  onCommitExpandedChange?: (expanded: boolean) => void;
  onCommitted: () => void;
  onRefresh: () => void;
}) {
  const allPaths = useMemo(() => files.map((f) => f.path), [files]);
  const filesByPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const [staged, setStaged] = useState<Set<string>>(() => new Set(allPaths));
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [localCommitExpanded, setLocalCommitExpanded] = useState(false);
  const commitExpanded = controlledCommitExpanded ?? localCommitExpanded;
  const setCommitExpanded = (expanded: boolean) => {
    setLocalCommitExpanded(expanded);
    onCommitExpandedChange?.(expanded);
  };
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const textGenAgentId = useUi((s) => s.textGenAgentId);
  const textGenModel = useUi((s) => s.textGenModel);
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [rollbackConfirmation, setRollbackConfirmation] = useState<string | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const [groupBy, setGroupBy] = useState<"directory" | "flat">("directory");
  const [shelveBusy, setShelveBusy] = useState(false);
  const groupMenuId = useRef(`changes-groupby-${taskId}`).current;
  const scrollRef = useRef<HTMLDivElement>(null);

  // A project can hold more than one checkout (nested repos). One root keeps
  // the flat tree; several group the files under a node per root.
  const rootsQuery = useQuery({
    queryFn: daemonQuery<GitRoots>("git.roots", { task_id: taskId }),
    queryKey: ["gitRoots", taskId],
  });
  const roots = useMemo(() => rootsQuery.data?.roots ?? [], [rootsQuery.data]);

  // Ignored files are their own cheap read (`git.ignored` runs one
  // `ls-files`): the toggle must not recompute the full diff, which on a
  // large repo means re-parsing every tracked+untracked hunk.
  const ignoredQuery = useQuery({
    enabled: showIgnored,
    queryFn: daemonQuery<GitIgnoredFiles>("git.ignored", { task_id: taskId }),
    queryKey: ["gitIgnored", taskId],
  });
  const ignoredFiles = ignoredQuery.data?.ignored ?? [];
  // No data and a dead request (not merely pending) also means the scan
  // never ran — say so instead of implying the repo ignores nothing.
  const ignoredAvailable = ignoredQuery.data?.available ?? !ignoredQuery.isError;
  const ignoredTruncated = ignoredQuery.data?.truncated ?? false;
  const ignoredState = ignoredSectionState(
    showIgnored,
    ignoredQuery.isPending,
    ignoredFiles,
    ignoredAvailable,
  );

  const root = useMemo(
    () =>
      buildChangesRoot({
        files,
        flat: groupBy === "flat",
        project,
        roots,
        untrackedAvailable,
        untrackedPaths,
      }),
    [files, groupBy, project, roots, untrackedAvailable, untrackedPaths],
  );

  // Small change sets: expand all folders. Large ones: only the top-level
  // group nodes, so a big diff still opens instantly.
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => {
    const all = new Set<string>();
    collectFolderKeys(root, "", all);
    if (files.length <= 50) {
      return all;
    }
    return new Set([...root.children.values()].map((child) => child.name));
  });

  // Re-sync selection as the diff's file set changes (keep prior choices).
  useEffect(() => {
    setStaged((prev) => {
      const next = new Set(allPaths.filter((p) => prev.has(p) || prev.size === 0));
      if (next.size === prev.size && [...next].every((path) => prev.has(path))) {
        return prev;
      }
      return next;
    });
  }, [allPaths]);

  const rollbackSelectionKey = useMemo(
    () => `${allPaths.join("\0")}\n${[...staged].sort().join("\0")}`,
    [allPaths, staged],
  );
  const rollbackConfirm = rollbackConfirmation === rollbackSelectionKey;

  // Group nodes arrive after the first render (the roots read and the diff
  // land separately), so open each one the first time it shows up — without
  // reopening a group the user has since collapsed.
  const autoOpened = useRef<Set<string>>(new Set());
  useEffect(() => {
    const fresh = [...root.children.values()]
      .map((child) => child.name)
      .filter((name) => !autoOpened.current.has(name));
    if (fresh.length === 0) {
      return;
    }
    for (const name of fresh) {
      autoOpened.current.add(name);
    }
    setOpenFolders((prev) => new Set([...prev, ...fresh]));
  }, [root]);

  // Flatten visible tree rows.
  const rows = useMemo(() => {
    const out: FlatRow[] = [];
    flattenNode(root, 0, "", openFolders, out);
    return out;
  }, [root, openFolders]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    getScrollElement: () => scrollRef.current,
    overscan: 20,
  });

  const toggleFolder = useCallback((fk: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(fk)) {
        next.delete(fk);
      } else {
        next.add(fk);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const all = new Set<string>();
    collectFolderKeys(root, "", all);
    for (const child of root.children.values()) {
      all.add(child.name);
    }
    setOpenFolders(all);
  }, [root]);

  const collapseAll = useCallback(() => {
    setOpenFolders(new Set());
  }, []);

  const openGroupMenu = useCallback(() => {
    void showContextMenu({
      requestId: groupMenuId,
      items: [
        { type: "item", id: "by-directory", label: `${groupBy === "directory" ? "✓ " : ""}Directory` },
        { type: "item", id: "by-flat", label: `${groupBy === "flat" ? "✓ " : ""}Flat` },
      ],
    });
  }, [groupBy, groupMenuId]);

  useNativeContextMenu(
    groupMenuId,
    useMemo(
      () =>
        new Map<string, () => void>([
          ["by-directory", () => setGroupBy("directory")],
          ["by-flat", () => setGroupBy("flat")],
        ]),
      [],
    ),
  );

  // NOTE: no ⌘+/⌘- shortcuts here on purpose — those are taken globally
  // by UI font-size zoom, and hijacking them inside the rail would fight it.

  const toggle = useCallback((paths: string[], on: boolean) => {
    setStaged((prev) => {
      const next = new Set(prev);
      for (const p of paths) {
        if (on) {
          next.add(p);
        } else {
          next.delete(p);
        }
      }
      return next;
    });
  }, []);

  const handleContextMenu = useChangesContextMenu({
    filesByPath,
    onRefresh,
    onSelect,
    onShelve: onShelveRequest,
    onStash: onStashRequest,
    staged,
    taskId,
    toggle,
    untrackedPaths,
  });

  const canCommit = !busy && staged.size > 0 && (message.trim().length > 0 || amend);

  /**
   * Turning on amend fills the box with the commit being rewritten, so the
   * message is there to edit instead of having to be retyped. Anything the user
   * wrote themselves is left alone, and unchecking only takes back a message we
   * put there ourselves.
   */
  const prefilledMessage = useRef<string | null>(null);
  const toggleAmend = async (next: boolean) => {
    setAmend(next);
    if (!next) {
      if (prefilledMessage.current !== null && message === prefilledMessage.current) {
        setMessage("");
      }
      prefilledMessage.current = null;
      return;
    }
    if (message.trim().length > 0) return;
    try {
      const last = await daemon.lastCommitMessage(taskId);
      if (!last) return;
      prefilledMessage.current = last;
      setMessage((current) => (current.trim().length > 0 ? current : last));
    } catch (e) {
      reportGitFailure("Could not read the last commit message", e);
    }
  };
  const canRollback = !rollbackBusy && staged.size > 0;

  const commit = async () => {
    setBusy(true);
    try {
      const all = staged.size === allPaths.length;
      await daemon.request("git.commit", {
        amend,
        files: all ? null : [...staged],
        message: message.trim(),
        task_id: taskId,
      });
      setMessage("");
      setAmend(false);
      setCommitExpanded(false);
      onCommitted();
    } catch (e) {
      reportGitFailure(amend ? "Could not amend the commit" : "Could not commit", e);
    } finally {
      setBusy(false);
    }
  };

  const generateMessage = async () => {
    if (!textGenAgentId || generating) {
      return;
    }
    setGenerating(true);
    try {
      const text = await daemon.generateText(
        taskId,
        textGenAgentId,
        "commit_message",
        textGenModel ?? undefined,
      );
      setMessage(text);
    } catch (e) {
      reportGitFailure("Could not draft a commit message", e);
    } finally {
      setGenerating(false);
    }
  };

  const shelveSilently = async () => {
    if (shelveBusy || staged.size === 0) {
      return;
    }
    setShelveBusy(true);
    try {
      await daemon.request("shelf.create", {
        name: "",
        paths: [...staged],
        task_id: taskId,
      });
      onRefresh();
    } catch (e) {
      reportGitFailure("Could not shelve the selected changes", e);
    } finally {
      setShelveBusy(false);
    }
  };

  const rollbackChecked = async () => {
    if (!canRollback) {
      return;
    }
    if (!rollbackConfirm) {
      setRollbackConfirmation(rollbackSelectionKey);
      return;
    }
    setRollbackBusy(true);
    try {
      await Promise.all(
        [...staged].flatMap((path) => {
          const file = filesByPath.get(path);
          if (!file) return [];
          const indices = file.status === "added" ? [0] : file.hunks.map((_, i) => i).reverse();
          return indices.map((hunkIndex) =>
            daemon.request("diff.resolveHunk", {
              file: path,
              hunk_index: hunkIndex,
              resolution: "reject",
              task_id: taskId,
            }),
          );
        }),
      );
      setRollbackConfirmation(null);
      onRefresh();
    } catch (e) {
      reportGitFailure("Could not roll back the selected changes", e);
    } finally {
      setRollbackBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex h-9 items-center gap-2 border-b border-rule px-3 text-sm font-semibold">
        <button
          type="button"
          aria-label="Expand all"
          title="Expand all"
          onClick={expandAll}
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <UnfoldVertical className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Collapse all"
          title="Collapse all"
          onClick={collapseAll}
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <FoldVertical className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Group by"
          title={`Group by: ${groupBy === "directory" ? "Directory" : "Flat"}`}
          onClick={openGroupMenu}
          className={cn(
            "rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground",
            groupBy === "flat" && "text-foreground",
          )}
        >
          <FolderTree className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Shelve silently"
          title="Shelve checked files without asking (⇧⌘H)"
          disabled={shelveBusy || staged.size === 0}
          onClick={() => void shelveSilently()}
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
        >
          <Archive className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Refresh changes"
          title="Refresh changes"
          onClick={onRefresh}
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <RefreshCw className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={rollbackConfirm ? "Confirm rollback checked files" : "Rollback checked files"}
          title={
            rollbackConfirm ? "Click again to rollback checked files" : "Rollback checked files"
          }
          disabled={!canRollback}
          onClick={rollbackChecked}
          className={cn(
            "rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40",
            rollbackConfirm && "text-destructive hover:text-destructive",
          )}
        >
          <Undo2 className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={showIgnored ? "Hide ignored files" : "Show ignored files"}
          title={showIgnored ? "Hide ignored files" : "Show ignored files"}
          aria-pressed={showIgnored}
          onClick={() => setShowIgnored((on) => !on)}
          className={cn(
            "rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground",
            showIgnored && "text-foreground",
          )}
        >
          {showIgnored ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </button>
      </div>
      <div className="flex h-8 items-center gap-2 border-b border-rule bg-secondary/55 px-3 text-xs text-muted-foreground">
        <input
          aria-label="Stage all files"
          type="checkbox"
          checked={staged.size === allPaths.length && allPaths.length > 0}
          disabled={allPaths.length === 0}
          ref={(el) => {
            if (el) el.indeterminate = staged.size > 0 && staged.size < allPaths.length;
          }}
          onChange={(e) => setStaged(e.target.checked ? new Set(allPaths) : new Set())}
          className="size-3 accent-primary"
        />
        <span className="tnum">
          {staged.size}/{allPaths.length} files
        </span>
      </div>

      {!untrackedAvailable && (
        <p className="border-b border-rule px-3 py-1.5 text-xs text-warn">
          Unversioned files unavailable.
        </p>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto py-1.5">
        {rows.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No changes.</p>
        ) : (
          <div className="relative w-max min-w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              return (
                <FileTreeRow
                  key={vi.key}
                  row={row}
                  vi={vi}
                  staged={staged}
                  selected={selected}
                  openFolders={openFolders}
                  onToggle={toggle}
                  onToggleFolder={toggleFolder}
                  onSelect={onSelect}
                  onContextMenu={handleContextMenu}
                />
              );
            })}
          </div>
        )}

        <IgnoredFiles
          state={ignoredState}
          files={ignoredFiles}
          truncated={ignoredTruncated}
          selected={selected}
          onSelect={onSelect}
          onOpenFile={onOpenFile}
        />
      </div>

      {files.length > 0 && (
        <CommitBox
          commitExpanded={commitExpanded}
          setCommitExpanded={setCommitExpanded}
          stagedSize={staged.size}
          message={message}
          setMessage={setMessage}
          amend={amend}
          setAmend={(v) => void toggleAmend(v)}
          busy={busy}
          generating={generating}
          canCommit={canCommit}
          onCommit={commit}
          onGenerate={generateMessage}
          textGenAgentId={textGenAgentId}
        />
      )}
    </div>
  );
}
