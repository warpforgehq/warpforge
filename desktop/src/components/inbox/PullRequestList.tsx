import { GitPullRequest } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PullRequestSummary } from "@/protocol";

import { PullRequestRow, type PullRequestRowActions } from "./PullRequestRow";

export interface PullRequestListProps {
  items: PullRequestSummary[];
  /** Keys of PRs the user has not seen yet (`inboxItemKey`). */
  unseenKeys: ReadonlySet<string>;
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
 */
export function PullRequestList({
  items,
  unseenKeys,
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
    return <Message>Loading pull requests…</Message>;
  }
  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <GitPullRequest aria-hidden className="size-5 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">{emptyHint ?? "No open pull requests."}</p>
      </div>
    );
  }
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      {items.map((pr) => {
        const key = `${pr.repo}#${pr.number}`;
        return (
          <PullRequestRow
            key={key}
            pr={pr}
            unseen={unseenKeys.has(key)}
            active={key === selectedKey}
            actions={actions}
          />
        );
      })}
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

/** The toolbar row the inbox views share: search, state toggle. */
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
    <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/70 px-2">
      <Input
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Filter pull requests"
        aria-label="Filter pull requests"
        spellCheck={false}
        className="h-7 min-w-0 flex-1 border-transparent bg-transparent px-2 text-xs shadow-none focus-visible:border-border"
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
