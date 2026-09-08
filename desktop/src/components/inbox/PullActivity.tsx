import { GitPullRequest, MessageSquareCode } from "lucide-react";
import * as React from "react";

import { relativeTime } from "@/components/backlog/BacklogRow";
import { PullCommentForm } from "@/components/inbox/PullCommentForm";
import { PullThreadCard } from "@/components/inbox/PullThreadCard";
import { quoteFromDiffHunk } from "@/lib/pullDiff";
import { cn } from "@/lib/utils";
import type { PullComment, PullRequestSummary, PullThread } from "@/protocol";

/**
 * What happened on this pull request, as a timeline of cards: it opened, then
 * every review and conversation comment in the order they arrived, then the
 * box for adding one.
 *
 * Inline review threads are not here — they live on the lines they were
 * written about, on the Diff tab. The one exception is a thread GitHub has
 * outdated (it drops `line` and keeps `originalLine`), which no diff row can
 * carry any more: those render here with the hunk they were written against,
 * or they would simply vanish.
 */
export function PullActivity({
  pr,
  thread,
  onPosted,
  onOpenDiff,
}: {
  pr: PullRequestSummary;
  thread: PullThread | null;
  onPosted: () => void;
  /** Fired by a review's "N code comments" footer — the comments are on the
   *  Diff tab, so the link has to take you there. */
  onOpenDiff?: () => void;
}) {
  const comments = thread?.comments ?? [];

  /**
   * How many inline comments each author left, so a review card can say what
   * it did to the code rather than only what it said about it.
   *
   * The wire shape does not tie an inline comment to the review it was
   * submitted with, so this counts per author and hangs the total off that
   * author's most recent review — which is where a reader looks for it. Two
   * reviews by the same bot in one PR would both want the number; only the
   * latest gets it.
   */
  const codeComments = React.useMemo(() => {
    const byAuthor = new Map<string, number>();
    for (const comment of thread?.comments ?? []) {
      if (comment.kind !== "review_comment") continue;
      const login = comment.author?.login;
      if (!login) continue;
      byAuthor.set(login, (byAuthor.get(login) ?? 0) + 1);
    }
    return byAuthor;
  }, [thread]);

  const latestReviewOf = React.useMemo(() => {
    const byAuthor = new Map<string, string>();
    for (const comment of thread?.comments ?? []) {
      if (comment.kind !== "review" || !comment.author?.login) continue;
      byAuthor.set(comment.author.login, comment.id);
    }
    return byAuthor;
  }, [thread]);

  const items = comments.filter(isActivityItem);

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">Activity</h3>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <GitPullRequest aria-hidden className="size-3.5 shrink-0 text-ok" />
        <span>Opened by {pr.author?.login || "ghost"}</span>
        {pr.createdAt > 0 && (
          <>
            <span aria-hidden className="text-border">
              ·
            </span>
            <span className="tnum" title={new Date(pr.createdAt * 1000).toLocaleString()}>
              {relativeTime(pr.createdAt * 1000)}
            </span>
          </>
        )}
      </div>

      {thread?.truncated && (
        <p className="text-xs text-muted-foreground/60">
          Older comments and reviews are hidden by GitHub's page limits.
        </p>
      )}

      {items.map((comment) => (
        <ActivityCard
          key={comment.id}
          project={pr.project}
          number={pr.number}
          comment={comment}
          codeComments={
            latestReviewOf.get(comment.author?.login ?? "") === comment.id
              ? (codeComments.get(comment.author?.login ?? "") ?? 0)
              : 0
          }
          onPosted={onPosted}
          onOpenDiff={onOpenDiff}
        />
      ))}

      {/* One place to say something at the conversation level, always at the
          foot of the timeline where the newest card is. */}
      <div className="min-w-0 rounded-md border border-border/70 bg-card px-3 py-2.5">
        <PullCommentForm
          project={pr.project}
          number={pr.number}
          placeholder="Leave a reply…"
          label="Comment body"
          submitLabel="Comment"
          onPosted={onPosted}
        />
      </div>
    </section>
  );
}

/**
 * Which conversation nodes the timeline carries. A review with neither a body
 * nor a verdict is GitHub's bookkeeping for "someone left inline comments" —
 * the comments themselves are on the diff, and an empty card here says
 * nothing.
 */
function isActivityItem(comment: PullComment): boolean {
  if (comment.kind === "comment") return true;
  if (comment.kind === "review") return !!comment.body.trim() || !!comment.state;
  // An outdated inline thread: no line to hang it on any more.
  return !comment.line;
}

const VERDICT_CHIP: Record<string, { label: string; className: string }> = {
  APPROVED: { className: "border-ok/40 bg-ok/10 text-ok", label: "Approved" },
  CHANGES_REQUESTED: {
    className: "border-destructive/40 bg-destructive/10 text-destructive",
    label: "Changes requested",
  },
  COMMENTED: {
    className: "border-border bg-secondary/60 text-muted-foreground",
    label: "Reviewed",
  },
  DISMISSED: {
    className: "border-border bg-secondary/40 text-muted-foreground/70",
    label: "Dismissed",
  },
};

function ActivityCard({
  project,
  number,
  comment,
  codeComments,
  onPosted,
  onOpenDiff,
}: {
  project: string;
  number: number;
  comment: PullComment;
  /** Inline comments to credit this card with; zero renders no footer line. */
  codeComments: number;
  onPosted: () => void;
  onOpenDiff?: () => void;
}) {
  const [replying, setReplying] = React.useState(false);
  const verdict =
    comment.kind === "review" && comment.state ? VERDICT_CHIP[comment.state] : undefined;
  const outdated = comment.kind === "review_comment";
  const line = comment.originalLine ?? comment.line ?? undefined;
  const quote = React.useMemo(
    () =>
      outdated && comment.diffHunk && line
        ? (quoteFromDiffHunk(comment.diffHunk, line, comment.originalStartLine ?? undefined)
            ?.lines ?? undefined)
        : undefined,
    [comment.diffHunk, comment.originalStartLine, line, outdated],
  );

  const footer =
    replying || codeComments > 0 ? (
      <div className="flex min-w-0 flex-col gap-2">
        {codeComments > 0 && (
          <button
            type="button"
            className="flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground"
            title="These comments sit on the lines they were written about"
            onClick={onOpenDiff}
          >
            <MessageSquareCode aria-hidden className="size-3.5" />
            {codeComments} code {codeComments === 1 ? "comment" : "comments"}
          </button>
        )}
        {replying && (
          <PullCommentForm
            autoFocus
            project={project}
            number={number}
            threadId={comment.threadId || undefined}
            placeholder="Leave a reply…"
            label="Reply body"
            onCancel={() => setReplying(false)}
            onPosted={() => {
              setReplying(false);
              onPosted();
            }}
          />
        )}
      </div>
    ) : undefined;

  return (
    <PullThreadCard
      // An outdated thread still names its file; a review body belongs to the
      // pull request, so it gets no header bar at all.
      path={outdated ? comment.path || "" : undefined}
      line={outdated ? line : undefined}
      url={comment.url}
      resolved={comment.resolved}
      root={comment}
      quote={quote}
      chip={
        verdict ? (
          <span
            className={cn(
              "shrink-0 rounded border px-1.5 py-px text-[10px] font-medium",
              verdict.className,
            )}
          >
            {verdict.label}
          </span>
        ) : outdated ? (
          <span className="shrink-0 rounded border border-border bg-secondary/40 px-1.5 py-px text-[10px] font-medium text-muted-foreground/80">
            Outdated
          </span>
        ) : undefined
      }
      footer={footer}
      onReply={replying ? undefined : () => setReplying(true)}
    />
  );
}
