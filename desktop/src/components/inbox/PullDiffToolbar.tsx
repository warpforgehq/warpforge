import { ListTree } from "lucide-react";

import { PullCommitPicker } from "@/components/inbox/PullCommitPicker";
import type { CommitRange } from "@/lib/pullCommits";
import { cn } from "@/lib/utils";
import type { PullCommit } from "@/protocol";

/**
 * The Diff tab's own controls: what is in the change, what you have read of
 * it, and how it is drawn.
 *
 * The counts sit on the left as the two things a reviewer scopes by — files
 * and commits — and the reading controls on the right.
 */
export function PullDiffToolbar({
  files,
  viewed,
  truncated,
  railOpen,
  onToggleRail,
  mode,
  onModeChange,
  commits,
  commitsLoading,
  range,
  onRangeChange,
}: {
  files: number;
  viewed: number;
  truncated: boolean;
  railOpen: boolean;
  onToggleRail: () => void;
  mode: "unified" | "split";
  onModeChange: (mode: "unified" | "split") => void;
  commits: readonly PullCommit[];
  commitsLoading?: boolean;
  range: CommitRange | null;
  onRangeChange: (range: CommitRange | null) => void;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/70 px-2">
      <Pill
        icon={ListTree}
        label="Files"
        count={files}
        pressed={railOpen}
        title={railOpen ? "Hide the changed-file list" : "Show the changed-file list"}
        onClick={onToggleRail}
      />
      <PullCommitPicker
        commits={commits}
        range={range}
        onRangeChange={onRangeChange}
        loading={commitsLoading}
      />
      {/* Adds/deletions/file count live in the detail header; repeating them
          here read as two different tallies. The toolbar keeps what only this
          surface knows: viewed progress. */}
      <span className="tnum ml-1 text-xs text-muted-foreground">
        {viewed}/{files} viewed
      </span>
      {truncated && <span className="text-xs text-warn">diff truncated by the size cap</span>}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <div className="flex rounded-md border border-border/80 bg-background/30 p-0.5">
          {(["unified", "split"] as const).map((value) => (
            <button
              type="button"
              key={value}
              onClick={() => onModeChange(value)}
              className={cn(
                "rounded px-2 py-0.5 text-xs capitalize transition-colors",
                mode === value
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Pill({
  icon: Icon,
  label,
  count,
  pressed,
  title,
  onClick,
}: {
  icon: typeof ListTree;
  label: string;
  count?: number;
  pressed?: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs",
        pressed
          ? "border-border bg-secondary text-foreground"
          : "border-border/70 text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon aria-hidden className="size-3" />
      {label}
      {count !== undefined && <span className="tnum text-muted-foreground">{count}</span>}
    </button>
  );
}
