import { ChevronDown, ChevronRight, Square, SquareCheck } from "lucide-react";
import * as React from "react";

import { Input } from "@/components/ui/input";
import { countPatchStats, type PatchFileBlock } from "@/lib/pullDiff";
import {
  buildPullFileTree,
  compactPullFileTree,
  flattenPullTree,
  pullTreeFileCount,
  pullTreeFolders,
  type PullTreeNode,
} from "@/lib/pullFileTree";
import { cn } from "@/lib/utils";

/**
 * The changed-file rail: what this pull request touches, as a folder tree,
 * plus what you have ticked off and a filter to reach one file in a 40-file
 * review without scrolling for it. Selecting a file scrolls the diff to it —
 * the rail navigates, it does not hide anything.
 *
 * Filtering flattens the tree on purpose: someone typing a name wants the
 * matches, not the folders they happen to live in.
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
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/70 px-2">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter files"
          aria-label="Filter changed files"
          spellCheck={false}
          className="h-7 min-w-0 flex-1 border-transparent bg-transparent px-2 text-xs shadow-none focus-visible:border-border"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {needle ? (
          matches.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-muted-foreground/60">No matching files.</p>
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
        ) : (
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
        )}
      </div>
    </div>
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
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{node.name}</span>
      <span className="tnum shrink-0 font-mono text-[10px] text-muted-foreground/50">
        {pullTreeFileCount(node)}
      </span>
    </button>
  );
}

function FileRow({
  name,
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
      {/* The name truncates and the counts never do: how big a file's change
          is decides whether you open it next. */}
      <span className="min-w-0 flex-1 truncate text-xs text-foreground/85">{name}</span>
      <span className="tnum flex shrink-0 items-center gap-1 font-mono text-[10px]">
        {additions > 0 && <span className="text-ok">+{additions}</span>}
        {deletions > 0 && <span className="text-destructive">−{deletions}</span>}
      </span>
    </button>
  );
}
