import { GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";
import * as React from "react";

import { elapsed } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { PullRequestSummary } from "@/protocol";

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
 * Both lanes are fixed width: the age column lines up down the list, and the
 * unread lane is reserved on every row so a read title starts where an unread
 * one does. An action dropped into either lane cannot reflow the row.
 */
export const PullRequestRow = React.memo(function PullRequestRow({
  pr,
  unseen,
  active,
  actions,
}: {
  pr: PullRequestSummary;
  unseen: boolean;
  active: boolean;
  actions: PullRequestRowActions;
}) {
  const ref = React.useRef<HTMLButtonElement>(null);

  // Keyboard navigation moves the selection, and the row it lands on has to
  // be on screen. `nearest` keeps a click from scrolling anything.
  React.useEffect(() => {
    if (!active) return;
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const draft = pr.draft && pr.state === "open";
  // The listing carries these, but an older cached payload may not.
  const additions = pr.additions ?? 0;
  const deletions = pr.deletions ?? 0;
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => actions.onOpen(pr)}
      title={pr.title}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-muted-foreground">
        {/* Draft is a state of the pull request, so it reads off the glyph
            rather than costing a word on the meta line. */}
        {draft ? (
          <GitPullRequestDraft
            aria-label="Draft"
            className="size-3.5 shrink-0 text-muted-foreground/60"
          />
        ) : pr.state === "open" ? (
          <GitPullRequest aria-hidden className="size-3.5 shrink-0 text-ok" />
        ) : (
          <GitPullRequestClosed
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground/60"
          />
        )}
        <span className="min-w-0 truncate" title={`${pr.repo}#${pr.number}`}>
          {pr.repo}
        </span>
        <span className="tnum shrink-0 text-muted-foreground/60">#{pr.number}</span>
        {/* Size before age: how big a review is decides whether you start it
            now. The repo name truncates first, since it repeats down the list. */}
        {additions + deletions > 0 && (
          <span
            className="tnum shrink-0"
            title={`+${additions} −${deletions} across ${pr.changedFiles ?? 0} files`}
          >
            <span className="text-ok">+{additions}</span>{" "}
            <span className="text-destructive">−{deletions}</span>
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
          {/* Reserved: the decision draws on some rows only, and the age column
              must not move when it does. */}
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            <ReviewDecisionGlyph decision={pr.reviewDecision} />
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
        <span aria-hidden className="flex size-1.5 shrink-0 items-center justify-center">
          {unseen && <span data-unread className="size-1.5 rounded-full bg-primary" />}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] leading-none",
            active ? "font-medium text-foreground" : "text-foreground/85",
          )}
        >
          {pr.title}
        </span>
      </span>
    </button>
  );
});
