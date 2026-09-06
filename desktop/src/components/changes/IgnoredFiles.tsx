import { ChevronRight, Folder } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import {
  buildIgnoredTree,
  countIgnored,
  describeIgnoredCounts,
  type IgnoredDirNode,
  type IgnoredSectionState,
  type IgnoredTreeNode,
} from "./changesTree";

/**
 * The `.gitignore`'d paths, behind the rail's toggle. Entries group into a
 * directory tree; a `dir/` entry is a wholly-ignored dir the server collapsed
 * (`node_modules/` = 1 row) — rendered as a leaf and never expanded, same as
 * JetBrains. Plain files are listed, not staged: a checkbox here would offer
 * a commit that cannot happen.
 */
export function IgnoredFiles({
  state,
  files,
  truncated,
  selected,
  onSelect,
  onOpenFile,
}: {
  state: IgnoredSectionState;
  files: string[];
  /** True when the server capped the listing — say so, don't imply completeness. */
  truncated: boolean;
  selected: string | null;
  onSelect: (path: string) => void;
  /** Open a file for reading (the files surface). Falls back to `onSelect`
   * when absent — but ignored files have no diff, so callers should pass it. */
  onOpenFile?: (path: string) => void;
}) {
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set());
  // Shut by default: an ignored tree is mostly build output you wade through
  // to reach the one `.env` you actually wanted.
  const [allOpen, setAllOpen] = useState(false);

  const tree = useMemo(() => buildIgnoredTree(files), [files]);
  const counts = useMemo(() => describeIgnoredCounts(countIgnored(tree)), [tree]);

  if (state === "hidden") {
    return null;
  }

  const toggleFolder = (path: string) => {
    setAllOpen(false);
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };
  const isOpen = (node: IgnoredDirNode) => allOpen || openFolders.has(node.path);
  const openFile = onOpenFile ?? onSelect;

  const renderNode = (node: IgnoredTreeNode, depth: number): ReactNode => {
    const pad = { paddingLeft: `${depth * 12 + 12}px` };
    if (node.kind === "file") {
      return (
        <button
          key={node.path}
          type="button"
          title={node.path}
          onClick={() => openFile(node.path)}
          style={pad}
          className={cn(
            "flex h-7 w-max min-w-full items-center pr-2 text-left text-xs text-muted-foreground hover:bg-secondary/50",
            selected === node.path && "bg-secondary text-foreground",
          )}
        >
          <span className="whitespace-nowrap">{node.name}</span>
        </button>
      );
    }
    if (node.collapsed) {
      return (
        <div
          key={node.path}
          title={`${node.path}/ — ignored as a whole, not expandable`}
          style={pad}
          className="flex h-7 w-max min-w-full cursor-default items-center gap-1.5 pr-2 text-xs text-muted-foreground"
        >
          <Folder className="size-3.5 shrink-0" />
          <span className="whitespace-nowrap">{node.name}</span>
        </div>
      );
    }
    const open = isOpen(node);
    const inner = describeIgnoredCounts(countIgnored(node.children));
    return (
      <div key={node.path}>
        <button
          type="button"
          onClick={() => toggleFolder(node.path)}
          title={node.path}
          style={pad}
          className="flex h-7 w-max min-w-full items-center gap-1.5 pr-2 text-left text-xs text-muted-foreground hover:bg-secondary/50"
        >
          <ChevronRight
            className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
          />
          <Folder className="size-3.5 shrink-0" />
          <span className="whitespace-nowrap">{node.name}</span>
          {inner.length > 0 && (
            <span className="ml-auto shrink-0 pl-2 text-[10px] opacity-70">{inner}</span>
          )}
        </button>
        {open && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="mt-1.5 border-t border-rule pt-1.5">
      <p
        className="flex items-baseline gap-2 overflow-hidden whitespace-nowrap px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        title={state === "list" ? `Ignored Files — ${counts}` : "Ignored Files"}
      >
        <span className="shrink-0">Ignored Files</span>
        {state === "list" && counts.length > 0 && (
          <span className="truncate font-normal normal-case opacity-70">{counts}</span>
        )}
      </p>
      {state === "loading" && (
        <p className="px-3 py-1 text-xs text-muted-foreground">Loading ignored files…</p>
      )}
      {state === "unavailable" && (
        <p className="px-3 py-1 text-xs text-warn">Ignored files unavailable.</p>
      )}
      {state === "empty" && (
        <p className="px-3 py-1 text-xs text-muted-foreground">No ignored files.</p>
      )}
      {state === "list" && tree.map((node) => renderNode(node, 0))}
      {state === "list" && truncated && (
        <p className="px-3 py-1 text-xs text-warn">
          Not all ignored files are shown — the list was truncated.
        </p>
      )}
    </div>
  );
}
