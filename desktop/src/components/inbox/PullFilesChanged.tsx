import {
  ChevronDown,
  ChevronRight,
  Database,
  FileCode2,
  FileText,
  FlaskConical,
  Package,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import {
  groupPullFiles,
  type PullFileGroup,
  type PullFileGroupId,
  type PullGroupedFile,
} from "@/lib/pullFileGroups";
import { cn } from "@/lib/utils";
import type { PullRequestFile } from "@/protocol";

import { PullFilesChangedSkeleton } from "./PullFilesChangedSkeleton";

/** A glyph per group, so the list reads even when the labels are scrolled off. */
export const PULL_GROUP_ICONS: Record<PullFileGroupId, LucideIcon> = {
  config: Settings2,
  docs: FileText,
  generated: Package,
  implementation: FileCode2,
  migrations: Database,
  tests: FlaskConical,
};

/** A colour per group, so the six blocks are told apart at a glance before the
 *  labels are read — amber for the migrations you must get right, warm orange
 *  for the generated tail you skip, a distinct hue for each thing between. */
export const PULL_GROUP_ICON_CLASS: Record<PullFileGroupId, string> = {
  config: "text-violet-400",
  docs: "text-blue-400",
  generated: "text-orange-400",
  implementation: "text-sky-400",
  migrations: "text-amber-400",
  tests: "text-emerald-400",
};

/**
 * What this pull request touches, grouped by the kind of attention each file
 * needs rather than by folder.
 *
 * The Diff tab has the folder tree for navigating; this list is for sizing up
 * the review before you start it, which is why the groups are ordered by
 * review weight — migrations first, lockfiles last. Nothing opens by default
 * so the list is six headings until you choose a block; a lone group opens,
 * because it is the whole list and has no choice to make. Clicking a file
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
  // A lone group is the whole list; fold it and there is nothing to see.
  const soleGroup = groups.length === 1;

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
            <FileGroup key={group.id} group={group} autoOpen={soleGroup} onOpenFile={onOpenFile} />
          ))}
        </div>
      ) : (
        <PullFilesChangedSkeleton />
      )}
    </section>
  );
}

function FileGroup({
  group,
  autoOpen,
  onOpenFile,
}: {
  group: PullFileGroup;
  /** Opens before the reviewer clicks, when this group is the whole list. */
  autoOpen: boolean;
  onOpenFile?: (path: string) => void;
}) {
  // Nothing opens until a click, unless this is the only group there is. A
  // 3-file docs group under twenty files of code is context, not work.
  const [override, setOverride] = React.useState<boolean | null>(null);
  const open = override ?? (autoOpen || group.defaultOpen);
  const Icon = PULL_GROUP_ICONS[group.id];
  const noise = group.tone === "noise";

  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOverride(!open)}
        className="sticky top-0 z-10 flex h-7 w-full min-w-0 shrink-0 items-center gap-1.5 bg-background px-1 text-left hover:bg-secondary/40"
      >
        <Icon aria-hidden className={cn("size-3 shrink-0", PULL_GROUP_ICON_CLASS[group.id])} />
        <span
          className={cn(
            "min-w-0 truncate text-xs font-medium",
            noise ? "text-muted-foreground/70" : "text-foreground/85",
          )}
        >
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
            <FileRow key={file.path} file={file} dim={noise} onOpenFile={onOpenFile} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({
  file,
  dim,
  onOpenFile,
}: {
  file: PullGroupedFile;
  dim?: boolean;
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
        dim && "opacity-70",
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
