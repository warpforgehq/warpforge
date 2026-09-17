import {
  ChevronDown,
  ChevronRight,
  LayoutList,
  ListTree,
  Square,
  SquareCheck,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";

import { PULL_GROUP_ICON_CLASS, PULL_GROUP_ICONS } from "@/components/inbox/PullFilesChanged";
import { Input } from "@/components/ui/input";
import { countPatchStats, type PatchFileBlock } from "@/lib/pullDiff";
import { groupPullFiles, type PullFileGroup } from "@/lib/pullFileGroups";
import {
  buildPullFileTree,
  compactPullFileTree,
  flattenPullTree,
  pullTreeFileCount,
  pullTreeFolders,
  type PullTreeNode,
} from "@/lib/pullFileTree";
import { cn } from "@/lib/utils";
import type { PullRequestFile } from "@/protocol";

/** Which of the two readings of the file list the rail is showing. */
type FilesView = "tree" | "groups";

const VIEW_KEY = "wf-pull-files-view";

/** Per-device preference: which reading of a diff you like is not a fact
 *  about the PR, so it lives in localStorage beside the viewed marks. */
function readFilesView(): FilesView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "groups" ? "groups" : "tree";
  } catch {
    return "tree";
  }
}

function writeFilesView(view: FilesView) {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Storage is a convenience here; the session keeps the toggle either way.
  }
}

/**
 * The changed-file rail: what this pull request touches, plus what you have
 * ticked off and a filter to reach one file in a 40-file review without
 * scrolling for it. Selecting a file scrolls the diff to it — the rail
 * navigates, it does not hide anything.
 *
 * Two readings share the rail. *Tree* is the folder hierarchy, for finding a
 * file you already have in mind. *Groups* is the same triage the overview
 * uses — migrations, implementation, tests, config, generated, docs — for
 * working through the review a block at a time ("let me do the migrations
 * first"). Filtering flattens either one on purpose: someone typing a name
 * wants the matches, not the folders they happen to live in.
 */
export function PullFilesRail({
  blocks,
  viewed,
  activePath,
  onSelect,
  onToggleViewed,
}: {
  blocks: readonly PatchFileBlock[];
  viewed: ReadonlySet<string>;
  activePath: string | null;
  onSelect: (path: string) => void;
  /** Ticks a file off from the rail. Same handler the file header uses. */
  onToggleViewed: (path: string) => void;
}) {
  const [filter, setFilter] = React.useState("");
  const needle = filter.trim().toLowerCase();
  const [view, setView] = React.useState<FilesView>(readFilesView);
  const changeView = (next: FilesView) => {
    setView(next);
    writeFilesView(next);
  };

  const tree = React.useMemo(() => compactPullFileTree(buildPullFileTree(blocks)), [blocks]);
  // Every folder starts open: a review you have to unfold before you can see
  // it is worse than the flat list this replaced.
  const [closed, setClosed] = React.useState<ReadonlySet<string>>(() => new Set());
  const open = React.useMemo(() => {
    const keys = new Set(pullTreeFolders(tree));
    for (const key of closed) keys.delete(key);
    return keys;
  }, [closed, tree]);

  const rows = React.useMemo(() => flattenPullTree(tree, open), [open, tree]);

  const grouped = React.useMemo<PullRequestFile[]>(
    () =>
      blocks.map((block) => {
        const stats = countPatchStats([block]);
        return { additions: stats.additions, deletions: stats.deletions, path: block.path };
      }),
    [blocks],
  );
  const groups = React.useMemo(() => groupPullFiles(grouped), [grouped]);
  // A click on a group heading overrides its default. Nothing opens on its
  // own, unless there is only one group — then there is nothing to choose
  // between, and a closed heading over an empty pane helps nobody.
  const soleGroup = groups.length === 1;
  const [groupOverrides, setGroupOverrides] = React.useState<Record<string, boolean>>({});

  const matches = React.useMemo(
    () => (needle ? blocks.filter((block) => block.path.toLowerCase().includes(needle)) : []),
    [blocks, needle],
  );

  const toggleFolder = (key: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-rule px-2">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter files"
          aria-label="Filter changed files"
          spellCheck={false}
          className="h-7 min-w-0 flex-1 border-transparent bg-transparent px-2 text-[13px] shadow-none focus-visible:border-border"
        />
        <div
          role="group"
          aria-label="File list view"
          className="flex shrink-0 items-center rounded border border-border p-0.5"
        >
          <ViewButton
            active={view === "tree"}
            icon={ListTree}
            label="Tree"
            onClick={() => changeView("tree")}
          />
          <ViewButton
            active={view === "groups"}
            icon={LayoutList}
            label="Groups"
            onClick={() => changeView("groups")}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {needle ? (
          matches.length === 0 ? (
            <p className="px-2.5 py-2 text-[13px] text-muted-foreground/60">No matching files.</p>
          ) : (
            matches.map((block) => (
              <FileRow
                key={block.path}
                name={block.path}
                path={block.path}
                additions={countPatchStats([block]).additions}
                deletions={countPatchStats([block]).deletions}
                depth={0}
                active={block.path === activePath}
                viewed={viewed.has(block.path)}
                onSelect={onSelect}
                onToggleViewed={onToggleViewed}
              />
            ))
          )
        ) : view === "tree" ? (
          rows.map((row) =>
            row.folder ? (
              <FolderRow
                key={row.key}
                node={row.node}
                depth={row.depth}
                open={open.has(row.folder)}
                onToggle={() => toggleFolder(row.folder!)}
              />
            ) : (
              <FileRow
                key={row.key}
                name={row.node.name}
                path={row.node.path ?? ""}
                additions={row.node.additions}
                deletions={row.node.deletions}
                depth={row.depth}
                active={row.node.path === activePath}
                viewed={viewed.has(row.node.path ?? "")}
                onSelect={onSelect}
                onToggleViewed={onToggleViewed}
              />
            ),
          )
        ) : (
          groups.map((group) => (
            <GroupSection
              key={group.id}
              group={group}
              open={groupOverrides[group.id] ?? (soleGroup || group.defaultOpen)}
              onToggle={() =>
                setGroupOverrides((current) => ({
                  ...current,
                  [group.id]: !(current[group.id] ?? (soleGroup || group.defaultOpen)),
                }))
              }
              viewed={viewed}
              activePath={activePath}
              onSelect={onSelect}
              onToggleViewed={onToggleViewed}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ViewButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${label} view`}
      title={`${label} view`}
      onClick={onClick}
      className={cn(
        "grid size-6 place-items-center rounded-sm",
        active ? "bg-accent text-foreground" : "text-muted-foreground/60 hover:bg-secondary/50",
      )}
    >
      <Icon aria-hidden className="size-3.5" />
    </button>
  );
}

/** Indent by depth in the padding, the same 12px step the task ChangesRail's
 *  file tree uses, so the two trees read as one control. The row's hover and
 *  selection still span the full rail. */
function indent(depth: number): React.CSSProperties {
  return { paddingLeft: `${8 + depth * 12}px` };
}

function FolderRow({
  node,
  depth,
  open,
  onToggle,
}: {
  node: PullTreeNode;
  depth: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      title={node.name}
      style={indent(depth)}
      className="flex h-7 w-full min-w-0 items-center gap-1 pr-2.5 text-left hover:bg-secondary/40"
    >
      {open ? (
        <ChevronDown aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
      ) : (
        <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
      )}
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{node.name}</span>
      <span className="tnum shrink-0 font-mono text-[11px] text-muted-foreground/50">
        {pullTreeFileCount(node)}
      </span>
    </button>
  );
}

/** One triage block in the grouped reading, with how much of it is ticked. */
function GroupSection({
  group,
  open,
  onToggle,
  viewed,
  activePath,
  onSelect,
  onToggleViewed,
}: {
  group: PullFileGroup;
  open: boolean;
  onToggle: () => void;
  viewed: ReadonlySet<string>;
  activePath: string | null;
  onSelect: (path: string) => void;
  onToggleViewed: (path: string) => void;
}) {
  const Icon = PULL_GROUP_ICONS[group.id];
  const done = group.files.reduce((count, file) => count + (viewed.has(file.path) ? 1 : 0), 0);
  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="sticky top-0 z-10 flex h-7 w-full min-w-0 items-center gap-1 bg-background pr-2.5 text-left hover:bg-secondary/40"
        style={indent(0)}
      >
        {open ? (
          <ChevronDown aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
        ) : (
          <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
        )}
        <Icon aria-hidden className={cn("size-3 shrink-0", PULL_GROUP_ICON_CLASS[group.id])} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] font-medium",
            group.tone === "noise" ? "text-muted-foreground/70" : "text-foreground/85",
          )}
        >
          {group.label}
        </span>
        <span className="tnum shrink-0 font-mono text-[11px] text-muted-foreground/50">
          {done}/{group.files.length}
        </span>
      </button>
      {open &&
        group.files.map((file) => (
          <FileRow
            key={file.path}
            name={file.name}
            dir={file.dir}
            path={file.path}
            additions={file.additions}
            deletions={file.deletions}
            depth={1}
            active={file.path === activePath}
            viewed={viewed.has(file.path)}
            onSelect={onSelect}
            onToggleViewed={onToggleViewed}
          />
        ))}
    </div>
  );
}

function FileRow({
  name,
  dir,
  path,
  additions,
  deletions,
  depth,
  active,
  viewed,
  onSelect,
  onToggleViewed,
}: {
  name: string;
  dir?: string;
  path: string;
  additions: number;
  deletions: number;
  depth: number;
  active: boolean;
  viewed: boolean;
  onSelect: (path: string) => void;
  onToggleViewed: (path: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(path)}
      title={path}
      aria-current={active ? "true" : undefined}
      style={indent(depth)}
      className={cn(
        "flex h-7 w-full min-w-0 items-center gap-1 pr-2.5 text-left",
        active ? "bg-accent" : "hover:bg-secondary/40",
        viewed && "opacity-55",
      )}
    >
      {/* A real control, not a status glyph. The row itself scrolls the diff
          to this file, so the tick has to stop the click from reaching it. */}
      <span
        role="checkbox"
        tabIndex={0}
        aria-checked={viewed}
        aria-label={viewed ? `Mark ${path} as not viewed` : `Mark ${path} as viewed`}
        title={viewed ? "Mark as not viewed" : "Mark as viewed"}
        onClick={(event) => {
          event.stopPropagation();
          onToggleViewed(path);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          onToggleViewed(path);
        }}
        className="grid size-4 shrink-0 place-items-center rounded hover:bg-secondary"
      >
        {viewed ? (
          <SquareCheck aria-hidden className="size-3.5 text-ok" />
        ) : (
          <Square aria-hidden className="size-3.5 text-muted-foreground/50" />
        )}
      </span>
      {/* In folder-tree mode the folders already carry the directory; in the
          grouped reading the row has to say where the file lives itself. */}
      <span className="min-w-0 max-w-[70%] flex-1 truncate text-[13px] text-foreground/85">
        {name}
      </span>
      {dir && (
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/60">{dir}</span>
      )}
      <span className="tnum flex shrink-0 items-center gap-1 font-mono text-[11px]">
        {additions > 0 && <span className="text-ok">+{additions}</span>}
        {deletions > 0 && <span className="text-destructive">−{deletions}</span>}
      </span>
    </button>
  );
}
