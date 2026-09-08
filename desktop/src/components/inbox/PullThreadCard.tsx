import { MessageSquare, Reply } from "lucide-react";
import * as React from "react";

import { relativeTime } from "@/components/backlog/BacklogRow";
import { AuthorBadge } from "@/components/inbox/AuthorBadge";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { openExternalLink } from "@/lib/externalLinks";
import { cn } from "@/lib/utils";
import type { PullComment } from "@/protocol";

/**
 * One review thread as a card: a header naming where it sits, an optional
 * quote of the lines it talks about, the comments with their replies hanging
 * off a thread line, and the reply affordance at the foot.
 *
 * The card is the unit GitHub taught everyone to read — a review conversation
 * is not "some text next to some other text", it is a bounded exchange with a
 * place and a resolution. Every host renders through this: the diff hangs one
 * off its line, and the overview's Activity timeline uses the same card for a
 * review body, with no path to name and a verdict chip instead.
 */
export function PullThreadCard({
  path,
  line,
  url,
  resolved,
  root,
  quote,
  chip,
  onReply,
  footer,
  className,
}: {
  /** Where the thread sits, when it sits anywhere. A review body belongs to
   *  the pull request rather than to a line, and renders without the header
   *  bar this fills. */
  path?: string;
  line?: number | string;
  /** The comment's GitHub URL, when the wire carried one. */
  url?: string;
  resolved?: boolean;
  /** The thread's first comment; its `replies` hang under it. */
  root: PullComment;
  /** The lines to quote, already trimmed out of the patch. */
  quote?: readonly { kind: string; number: number; text: string }[];
  /** Rendered beside the first comment's timestamp — a review's verdict. */
  chip?: React.ReactNode;
  onReply?: () => void;
  /** Rendered at the foot — the composer when a reply is being written. */
  footer?: React.ReactNode;
  className?: string;
}) {
  const all = [root, ...root.replies];
  return (
    <div className={cn("overflow-hidden rounded-md border border-border/70 bg-card", className)}>
      {path ? (
        <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/60 bg-secondary/40 px-2.5">
          <MessageSquare aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
          <span
            className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
            title={path}
          >
            {path}
            {line ? <span className="tnum text-muted-foreground/60">:{line}</span> : null}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {resolved && (
              <span className="rounded border border-ok/40 bg-ok/10 px-1.5 py-px text-[10px] font-medium text-ok">
                Resolved
              </span>
            )}
            {url && (
              <button
                type="button"
                className="text-[11px] text-muted-foreground/60 hover:text-foreground"
                title="Open on GitHub"
                onClick={() => void openExternalLink(url)}
              >
                GitHub
              </button>
            )}
          </span>
        </div>
      ) : null}

      {quote && quote.length > 0 && (
        <div className="border-b border-border/50 bg-secondary/20 px-3 py-1.5 font-mono text-[11px] leading-5">
          {quote.map((row) => (
            <div
              key={`${row.kind}:${row.number}:${row.text}`}
              className={cn(
                "-mx-1 flex min-w-0 rounded-sm px-1",
                row.kind === "add" && "bg-ok/10",
                row.kind === "del" && "bg-destructive/10",
              )}
            >
              <span className="tnum w-8 shrink-0 select-none pr-2 text-right text-muted-foreground/40">
                {row.number}
              </span>
              <span
                className={cn(
                  "min-w-0 whitespace-pre-wrap break-all pr-2",
                  row.kind === "add" && "text-ok/90",
                  row.kind === "del" && "text-destructive/80",
                  (row.kind === "context" || row.kind === "meta") && "text-foreground/75",
                )}
              >
                {row.text || " "}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 px-3 py-2.5">
        {all.map((comment, index) => (
          <div key={comment.id} className={cn("flex min-w-0 gap-2.5", index > 0 && "pl-4")}>
            {index > 0 && <span aria-hidden className="mt-5 w-px shrink-0 bg-border/70" />}
            <AuthorBadge login={comment.author?.login ?? ""} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2 text-xs">
                <span className="font-medium text-foreground/85">
                  {comment.author?.login || "ghost"}
                </span>
                <span
                  className="tnum text-muted-foreground"
                  title={new Date(comment.createdAt).toLocaleString()}
                >
                  {relativeTime(Date.parse(comment.createdAt))}
                </span>
                {index === 0 && chip}
                {/* Without the header bar there is nowhere else for the link
                    to live, and a review body is the one thing you most often
                    want to open on GitHub. */}
                {index === 0 && !path && url && (
                  <button
                    type="button"
                    className="ml-auto shrink-0 text-[11px] text-muted-foreground/60 hover:text-foreground"
                    title="Open on GitHub"
                    onClick={() => void openExternalLink(url)}
                  >
                    GitHub
                  </button>
                )}
              </div>
              {comment.body.trim() && (
                <Markdown allowHtml className="mt-1 text-sm text-foreground/90">
                  {comment.body}
                </Markdown>
              )}
            </div>
          </div>
        ))}
      </div>

      {(onReply || footer) && (
        <div className="flex min-w-0 flex-col gap-2 border-t border-border/50 px-3 py-2">
          {footer}
          {/* A host that opens a composer clears `onReply` while it is open,
              so the two never stack. */}
          {onReply && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={onReply}
            >
              <Reply className="size-3" />
              Reply
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
