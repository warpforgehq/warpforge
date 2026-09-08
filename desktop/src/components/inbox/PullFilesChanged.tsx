import { ChevronDown, ChevronRight, FileCode2, FileText } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { groupPullFiles, type PullFileGroup, type PullGroupedFile } from "@/lib/pullFileGroups";
import { cn } from "@/lib/utils";
import type { PullRequestFile } from "@/protocol";

/** How many files a group shows before it hands the rest to an expander. */
const VISIBLE_FILES = 7;

/**
 * What this pull request touches, grouped by whether it is code or prose.
 *
 * The Diff tab has the folder tree for navigating; this list is for sizing up
 * the review before you start it, which is why implementation comes first and
 * opens, and documentation arrives folded with its total. Clicking a file
 * takes you to it on the Diff tab.
 */
export function PullFilesChanged({
  files,
  changedFiles,
  onOpenFile,
  onLoadFiles,
}: {
  /** The file list, once something has fetched it. */
  files: readonly PullRequestFile[] | null;
  /** The count from the listing — known long before the file list is. */
  changedFiles: number;
  onOpenFile?: (path: string) => void;
  /** Present when the list has not been fetched and can be, on request. */
  onLoadFiles?: () => void;
}) {
  const groups = React.useMemo(() => (files ? groupPullFiles(files) : []), [files]);
  const total = files?.length || changedFiles;

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h4 className="tnum text-xs text-muted-foreground">
        {total} {total === 1 ? "file" : "files"} changed
      </h4>
      {files ? (
        groups.map((group) => <FileGroup key={group.id} group={group} onOpenFile={onOpenFile} />)
      ) : onLoadFiles ? (
        // A big pull request does not load its file list on the overview: the
        // list rides the patch fetch, and walking the inbox with `j`/`k` must
        // not pull a megabyte per row.
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 self-start px-2 text-xs"
          onClick={onLoadFiles}
        >
          Show file list
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground/60">Loading files…</p>
      )}
    </section>
  );
}

function FileGroup({
  group,
  onOpenFile,
}: {
  group: PullFileGroup;
  onOpenFile?: (path: string) => void;
}) {
  // Implementation opens, documentation folds: the code is what the review is
  // for, and a 3-file docs group under it is context, not work.
  const [open, setOpen] = React.useState(group.id === "implementation");
  const [showAll, setShowAll] = React.useState(false);
  const visible = showAll ? group.files : group.files.slice(0, VISIBLE_FILES);
  const hidden = group.files.length - visible.length;

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded px-1 text-left hover:bg-secondary/40"
      >
        <span className="min-w-0 truncate text-xs font-medium text-foreground/85">
          {group.label}
        </span>
        <span className="tnum shrink-0 text-xs text-muted-foreground">{group.files.length}</span>
        {open ? (
          <ChevronDown aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
        ) : (
          <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
        )}
        <span className="tnum ml-auto flex shrink-0 items-center gap-1.5 text-xs">
          {group.additions > 0 && <span className="text-ok">+{group.additions}</span>}
          {group.deletions > 0 && <span className="text-destructive">−{group.deletions}</span>}
        </span>
      </button>
      {open && (
        <div className="ml-1 flex min-w-0 flex-col border-l border-border/60 pl-1.5">
          {visible.map((file) => (
            <FileRow key={file.path} file={file} onOpenFile={onOpenFile} />
          ))}
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="flex h-6 items-center gap-1.5 px-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
            >
              {hidden} more {hidden === 1 ? "file" : "files"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FileRow({
  file,
  onOpenFile,
}: {
  file: PullGroupedFile;
  onOpenFile?: (path: string) => void;
}) {
  const Icon = file.tag === "dataset" ? FileText : FileCode2;
  return (
    <button
      type="button"
      title={file.path}
      disabled={!onOpenFile}
      onClick={() => onOpenFile?.(file.path)}
      className={cn(
        "flex h-6 w-full min-w-0 items-center gap-1.5 rounded px-1.5 text-left",
        onOpenFile && "hover:bg-secondary/40",
      )}
    >
      <Icon aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
      {/* The name gives up its room last: which file it is decides whether
          you open it, and the folder only says where it lives. */}
      <span className="min-w-0 max-w-[70%] truncate text-xs text-foreground/85">{file.name}</span>
      {file.dir && (
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/60">
          {file.dir}
        </span>
      )}
      {file.tag && (
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/50">
          {file.tag}
        </span>
      )}
    </button>
  );
}
