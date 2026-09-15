import { GitPullRequest } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import type { PrAssistantState } from "@/lib/taskOrigin";
import { cn } from "@/lib/utils";
import type { PullRequestSummary } from "@/protocol";

import { PullRequestRow, type PullRequestRowActions } from "./PullRequestRow";
import { PullRequestRowSkeleton } from "./PullRequestRowSkeleton";

export interface PullRequestListProps {
  items: PullRequestSummary[];
  /** Keys of PRs the user has not seen yet (`inboxItemKey`). */
  unseenKeys: ReadonlySet<string>;
  /** Per-PR assistant state, keyed by `inboxItemKey`. */
  assistantStates?: ReadonlyMap<string, PrAssistantState>;
  selectedKey: string | null;
  actions: PullRequestRowActions;
  isLoading: boolean;
  error?: string;
  emptyHint?: string;
}

/**
 * The inbox's list. At most 50 rows per project arrive from the daemon, so
 * this is a plain list, not a virtualizer — paging a bounded list only adds
 * scrolling bugs.
 *
 * The gutter is the sidebar tree's own (`px-2`), because this list renders
 * inside it; the rows carry their fill and their separation, so there are no
 * divider lines running edge to edge.
 */
export function PullRequestList({
  items,
  unseenKeys,
  assistantStates,
  selectedKey,
  actions,
  isLoading,
  error,
  emptyHint,
}: PullRequestListProps) {
  if (error) {
    return <Message tone="error">{error}</Message>;
  }
  if (isLoading) {
    return <PullRequestRowSkeleton />;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        className="h-full"
        icon={GitPullRequest}
        title={emptyHint ?? "No open pull requests"}
      />
    );
  }
  return (
    <div className="h-full min-h-0 overflow-y-auto px-2 py-2 [scrollbar-gutter:stable]">
      <div className="flex flex-col gap-px">
        {items.map((pr) => {
          const key = `${pr.repo}#${pr.number}`;
          return (
            <PullRequestRow
              key={key}
              pr={pr}
              unseen={unseenKeys.has(key)}
              assistant={assistantStates?.get(key) ?? null}
              active={key === selectedKey}
              actions={actions}
            />
          );
        })}
      </div>
    </div>
  );
}

function Message({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <div
      className={cn(
        "flex h-full items-center justify-center px-4 py-8 text-center text-xs",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

/** The toolbar row the inbox views share: search, state toggle. It sits on the
 *  list's own gutter with no rule under it — the sidebar already draws one
 *  above, and two stacked lines is what made this read as a separate rail. */
export function InboxToolbar({
  search,
  onSearch,
  state,
  onStateChange,
  children,
}: {
  search: string;
  onSearch: (value: string) => void;
  state: "open" | "all";
  onStateChange: (state: "open" | "all") => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1.5 px-2 pt-1">
      {/* `text-xs!` because the shared `Input` ships `md:text-sm`, which
          outranks a plain `text-xs` and left the placeholder visibly larger
          than every row around it in the sidebar. */}
      <Input
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Filter pull requests"
        aria-label="Filter pull requests"
        spellCheck={false}
        className="h-7 min-w-0 flex-1 border-transparent bg-transparent px-2 text-xs! shadow-none focus-visible:border-border"
      />
      <div
        role="tablist"
        aria-label="Pull request state"
        className="flex shrink-0 items-center rounded-md bg-secondary/60 p-0.5"
      >
        {(["open", "all"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={state === value}
            onClick={() => onStateChange(value)}
            className={cn(
              "rounded px-2 py-0.5 text-xs capitalize transition-colors",
              state === value
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {value}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}
