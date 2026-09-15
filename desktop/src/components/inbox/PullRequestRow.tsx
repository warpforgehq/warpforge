import { useQueryClient } from "@tanstack/react-query";
import { Bot, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";
import * as React from "react";

import { daemon } from "@/daemon";
import { elapsed } from "@/lib/status";
import type { PrAssistantState } from "@/lib/taskOrigin";
import { cn } from "@/lib/utils";
import type { PullRequestSummary } from "@/protocol";

import { AssistantWorkingGlyph } from "./AssistantWorkingGlyph";
import { ReviewDecisionGlyph } from "./ReviewDecisionChip";

export interface PullRequestRowActions {
  onOpen: (pr: PullRequestSummary) => void;
}

/**
 * One pull request, in the sidebar's own row language. Anatomy:
 *
 *   [state] repo · #number · +N −N          [decision] [age]
 *   ● title …
 *
 * The row is inset and rounded like `SidebarTaskRow` rather than a full-bleed
 * band with a divider under it — the list lives in the sidebar now, and a row
 * that keeps its own gutters reads as a foreign rail beside the task tree.
 *
 * The repo name is the only lane that grows and truncates; the numeric lanes
 * stay `shrink-0`, so the listing keeps the owner's original composition while
 * the smaller type buys the repo back the room the fixed columns used to take.
 * The unread lane is reserved on every row so a read title starts where an
 * unread one does.
 */
export const PullRequestRow = React.memo(function PullRequestRow({
  pr,
  unseen,
  assistant = null,
  active,
  actions,
}: {
  pr: PullRequestSummary;
  unseen: boolean;
  /** What the PR's assistant task is doing, if it has one. */
  assistant?: PrAssistantState | null;
  active: boolean;
  actions: PullRequestRowActions;
}) {
  const ref = React.useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();

  // Keyboard navigation moves the selection, and the row it lands on has to
  // be on screen. `nearest` keeps a click from scrolling anything.
  React.useEffect(() => {
    if (!active) return;
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Warm the review the row points at, on the enter events only: hovering does
  // not fire per pointer move, and an already-cached key skips the request
  // entirely. Same keys and staleness the detail pane reads, or this is wasted.
  const prefetch = React.useCallback(() => {
    const detailsKey = ["pull", "details", pr.project, pr.number] as const;
    const threadKey = ["pull", "thread", pr.project, pr.number] as const;
    if (queryClient.getQueryData(detailsKey) === undefined) {
      void queryClient.prefetchQuery({
        queryKey: detailsKey,
        queryFn: () => daemon.pullDetails(pr.project, pr.number),
        staleTime: 60_000,
      });
    }
    if (queryClient.getQueryData(threadKey) === undefined) {
      void queryClient.prefetchQuery({
        queryKey: threadKey,
        queryFn: () => daemon.pullThread(pr.project, pr.number),
        staleTime: 30_000,
      });
    }
  }, [pr.number, pr.project, queryClient]);

  const draft = pr.draft && pr.state === "open";
  // The listing carries these, but an older cached payload may not.
  const additions = pr.additions ?? 0;
  const deletions = pr.deletions ?? 0;
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => actions.onOpen(pr)}
      onFocus={prefetch}
      onMouseEnter={prefetch}
      title={pr.title}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[10px] leading-[14px] text-muted-foreground/70">
        {/* Draft is a state of the pull request, so it reads off the glyph
            rather than costing a word on the meta line. */}
        {draft ? (
          <GitPullRequestDraft
            aria-label="Draft"
            className="size-3 shrink-0 text-muted-foreground/60"
          />
        ) : pr.state === "open" ? (
          <GitPullRequest aria-hidden className="size-3 shrink-0 text-ok" />
        ) : (
          <GitPullRequestClosed aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
        )}
        {/* The repo name truncates first, since it repeats down the list. */}
        <span className="min-w-0 truncate" title={`${pr.repo}#${pr.number}`}>
          {pr.repo}
        </span>
        <span className="tnum shrink-0 whitespace-nowrap text-muted-foreground/60">
          #{pr.number}
        </span>
        {/* Size before age: how big a review is decides whether you start it
            now. `whitespace-nowrap` keeps `+N −N` on one line — a wrapped pair
            made that row taller than every neighbour. */}
        {additions + deletions > 0 && (
          <span
            className="tnum shrink-0 whitespace-nowrap"
            title={`+${additions} −${deletions} across ${pr.changedFiles ?? 0} files`}
          >
            <span className="text-ok">+{additions}</span>{" "}
            <span className="text-destructive">−{deletions}</span>
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
          {/* ONE status column, always reserved. A second lane for the
              assistant put its glyph and the decision glyph at different x, so
              a list where only one of them draws read as a staircase; here the
              assistant takes the slot when it has something to say, and the
              decision glyph falls back into it otherwise. */}
          <span data-lane="status" className="flex size-3.5 shrink-0 items-center justify-center">
            {assistant === "running" ? (
              <AssistantWorkingGlyph className="size-3.5" />
            ) : assistant === "unseen" ? (
              <Bot aria-label="Assistant review ready" className="size-3.5 text-primary" />
            ) : (
              <ReviewDecisionGlyph decision={pr.reviewDecision} />
            )}
          </span>
          <span
            className="tnum w-8 shrink-0 text-right text-muted-foreground/70"
            title={new Date(pr.updatedAt * 1000).toLocaleString()}
          >
            {elapsed(pr.updatedAt)}
          </span>
        </span>
      </span>

      <span className="flex min-w-0 items-center gap-1.5">
        {unseen && (
          <span
            aria-hidden
            data-unread
            className="size-1.5 shrink-0 rounded-full bg-primary"
          />
        )}
        {/* The title is the brightest text in the row; the meta line is the
            only thing allowed to be quieter. */}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[12px] leading-4 text-foreground",
            active && "font-medium",
          )}
        >
          {pr.title}
        </span>
      </span>
    </button>
  );
});
