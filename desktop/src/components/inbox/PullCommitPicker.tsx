import { Check, GitCommitHorizontal, Square, SquareCheck } from "lucide-react";

import { relativeTime } from "@/components/backlog/BacklogRow";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  commitRangeLabel,
  selectedCommitIndexes,
  toggleCommitInRange,
  type CommitRange,
} from "@/lib/pullCommits";
import { cn } from "@/lib/utils";
import type { PullCommit } from "@/protocol";

/**
 * Which commits the diff covers.
 *
 * The list reads newest first, the way `git log` does, while the range itself
 * is expressed over the oldest-first order the daemon sends — a selection is
 * a contiguous run either way, and `lib/pullCommits` owns that arithmetic
 * because a diff of commits 1 and 3 without 2 is not something GitHub can
 * answer.
 */
export function PullCommitPicker({
  commits,
  range,
  onRangeChange,
  loading,
}: {
  commits: readonly PullCommit[];
  range: CommitRange | null;
  onRangeChange: (range: CommitRange | null) => void;
  loading?: boolean;
}) {
  const selected = new Set(selectedCommitIndexes(commits, range));
  const all = selected.size === 0;
  // Newest first to read, but the indexes stay the daemon's.
  const rows = commits.map((commit, index) => ({ commit, index })).reverse();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={loading || commits.length === 0}
        title={
          commits.length === 0
            ? "This pull request's commits could not be read"
            : "Review one commit at a time"
        }
        className={cn(
          "flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs disabled:text-muted-foreground/40",
          all
            ? "border-border/70 text-muted-foreground hover:text-foreground"
            : "border-primary/50 bg-primary/10 text-foreground",
        )}
      >
        <GitCommitHorizontal aria-hidden className="size-3" />
        Commits
        <span className="tnum text-muted-foreground">
          {all ? commits.length : `${selected.size}/${commits.length}`}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuItem
          className="gap-2 px-2 py-1.5 text-sm"
          onSelect={() => onRangeChange(null)}
        >
          <span className="flex-1">All commits</span>
          {all && <Check aria-hidden className="text-primary" />}
          <span className="tnum text-xs text-muted-foreground">
            {commitRangeLabel(commits, null)}
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="py-1 text-xs font-normal text-muted-foreground">
          Specific commits
        </DropdownMenuLabel>
        {/* A long branch is a long list; the picker scrolls rather than
            growing past the window. */}
        <div className="max-h-72 overflow-y-auto">
          {rows.map(({ commit, index }) => (
            <CommitRow
              key={commit.oid}
              commit={commit}
              checked={all || selected.has(index)}
              onSelect={() => onRangeChange(toggleCommitInRange(commits, range, index))}
            />
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CommitRow({
  commit,
  checked,
  onSelect,
}: {
  commit: PullCommit;
  checked: boolean;
  onSelect: () => void;
}) {
  const committed = Date.parse(commit.committedDate);
  return (
    <DropdownMenuItem
      // Picking a run takes two clicks, so the menu has to survive the first.
      onSelect={(event) => {
        event.preventDefault();
        onSelect();
      }}
      title={`${commit.oid}\n${commit.messageHeadline}`}
      className="min-w-0 gap-2 px-2 py-1.5"
    >
      {checked ? (
        <SquareCheck aria-hidden className="size-3.5 shrink-0 text-primary" />
      ) : (
        <Square aria-hidden className="size-3.5 shrink-0 text-muted-foreground/50" />
      )}
      <span className="tnum shrink-0 font-mono text-[11px] text-muted-foreground">
        {commit.abbreviatedOid || commit.oid.slice(0, 7)}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-foreground/90">
        {commit.messageHeadline}
      </span>
      {Number.isFinite(committed) && (
        <span
          className="tnum shrink-0 text-[11px] text-muted-foreground/70"
          title={new Date(committed).toLocaleString()}
        >
          {relativeTime(committed)}
        </span>
      )}
    </DropdownMenuItem>
  );
}
