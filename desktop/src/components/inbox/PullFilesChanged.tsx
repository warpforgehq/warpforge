import { ChevronDown, ChevronRight, FileCode2, FileText } from "lucide-react";
import * as React from "react";

import { groupPullFiles, type PullFileGroup, type PullGroupedFile } from "@/lib/pullFileGroups";
import { cn } from "@/lib/utils";
import type { PullRequestFile } from "@/protocol";

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
}: {
  /** The file list, once something has fetched it. */
  files: readonly PullRequestFile[] | null;
  /** The count from the listing — known long before the file list is. */
  changedFiles: number;
  onOpenFile?: (path: string) => void;
}) {
  const groups = React.useMemo(() => (files ? groupPullFiles(files) : []), [files]);
  const total = files?.length || changedFiles;

  return (
    <section className="flex min-w-0 flex-col gap-2 xl:min-h-0 xl:flex-1">
      <h4 className="tnum shrink-0 text-xs text-muted-foreground">
        {total} {total === 1 ? "file" : "files"} changed
      </h4>
      {files ? (
        /* One scroller for every group, not one each: two open groups sharing
           the height meant opening the second squashed the first. Each group's
           heading sticks to the top of this box instead, so it stays readable
           while its own rows move under it. */
        <div className="flex min-w-0 flex-col gap-1 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
          {groups.map((group) => (
            <FileGroup key={group.id} group={group} onOpenFile={onOpenFile} />
          ))}
        </div>
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

  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="sticky top-0 z-10 flex h-7 w-full min-w-0 shrink-0 items-center gap-1.5 bg-background px-1 text-left hover:bg-secondary/40"
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
          {group.files.map((file) => (
            <FileRow key={file.path} file={file} onOpenFile={onOpenFile} />
          ))}
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
