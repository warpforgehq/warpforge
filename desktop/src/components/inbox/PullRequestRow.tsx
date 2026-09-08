import { GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";
import * as React from "react";

import { relativeTime } from "@/components/backlog/BacklogRow";
import { cn } from "@/lib/utils";
import type { PullRequestSummary } from "@/protocol";

import { ReviewDecisionGlyph } from "./ReviewDecisionChip";

export interface PullRequestRowActions {
  onOpen: (pr: PullRequestSummary) => void;
}

/**
 * One pull request in the list rail: state, source, size, decision and age on
 * one line, the title under it, labels only if there are any. The rail is
 * ~320px wide, so this stacks rather than laying metadata out in columns — a
 * row that needs 700px to be legible has no business here.
 *
 * Everything countable lives on the top line on purpose. It used to share the
 * label line with a full-width "Review required" chip and the word "Draft",
 * which made three lines of the same row say four different things; state now
 * reads off the glyph, and the decision keeps a fixed place so the queue can
 * be scanned vertically.
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
        "flex w-full min-w-0 flex-col gap-2 border-b border-border/40 px-2.5 py-3 text-left transition-colors",
        active ? "bg-accent" : "hover:bg-secondary/40",
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
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
        <span
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          title={`${pr.repo}#${pr.number}`}
        >
          {pr.repo}
          <span className="tnum text-muted-foreground/60"> #{pr.number}</span>
        </span>
        {/* Size before age: how big a review is decides whether you start it
            now. The repo name truncates first, since it repeats down the list. */}
        {additions + deletions > 0 && (
          <span
            className="tnum shrink-0 text-xs"
            title={`+${additions} −${deletions} across ${pr.changedFiles ?? 0} files`}
          >
            <span className="text-ok">+{additions}</span>{" "}
            <span className="text-destructive">−{deletions}</span>
          </span>
        )}
        {/* The decision is what you scan a review queue for, so it sits in the
            same place on every row instead of after a variable-width chip. */}
        <ReviewDecisionGlyph decision={pr.reviewDecision} />
        <span
          className="tnum shrink-0 text-xs text-muted-foreground/70"
          title={new Date(pr.updatedAt * 1000).toLocaleString()}
        >
          {relativeTime(pr.updatedAt * 1000)}
        </span>
        {unseen && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />}
      </span>

      {/* A half-step below the prose size: at `text-sm` the title crowded the
          12px metadata above it. Still rem, so it follows the font setting. */}
      <span className="line-clamp-2 text-[0.8125rem] font-medium leading-normal text-foreground">
        {pr.title}
      </span>

      {/* Labels only. Everything else moved onto the top line, so most rows
          are two lines and the list fits more of the queue. */}
      {pr.labels.length > 0 && (
        <span className="flex min-w-0 items-center gap-1">
          {pr.labels.slice(0, 3).map((label) => (
            <Label key={label.name} label={label} />
          ))}
          {pr.labels.length > 3 && (
            <span
              className="tnum shrink-0 text-xs text-muted-foreground/60"
              title={pr.labels
                .slice(3)
                .map((label) => label.name)
                .join(", ")}
            >
              +{pr.labels.length - 3}
            </span>
          )}
        </span>
      )}
    </button>
  );
});

/**
 * One label, in the colour GitHub gave it. The wire has carried `color` all
 * along; without it every label is the same grey chip and the row reads as
 * noise instead of a signal you can learn.
 */
function Label({ label }: { label: PullRequestSummary["labels"][number] }) {
  const color = labelColor(label.color);
  return (
    <span
      title={label.name}
      className="inline-flex min-w-0 max-w-24 items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground"
    >
      {color && (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="min-w-0 truncate">{label.name}</span>
    </span>
  );
}

/** Only a bare `RRGGBB`; anything else is not going into a style attribute. */
function labelColor(value?: string | null): string | null {
  const hex = (value ?? "").trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex}` : null;
}
