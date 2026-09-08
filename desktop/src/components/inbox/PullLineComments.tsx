import { Lightbulb, Loader2 } from "lucide-react";
import * as React from "react";

import { PullThreadCard } from "@/components/inbox/PullThreadCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { daemon } from "@/daemon";
import { cn } from "@/lib/utils";
import type { PullComment } from "@/protocol";

/** What a composer is about to write: a fresh thread on a line, or a reply. */
export type CommentTarget = { kind: "new" } | { kind: "reply"; threadId: string };

/**
 * The review threads sitting on one diff line, plus the box for adding one.
 *
 * Each thread renders as the card the rest of the surface uses — header
 * naming the line, comments, reply at the foot — so the diff and the
 * conversation tab read as one system. A new comment opens a review thread on
 * the line (`side` is LEFT for a removed line, RIGHT for one that still
 * exists); replying rides the existing thread's node id. Both land on GitHub
 * straight away — this is not a draft review, which the inbox does not model.
 */
export function PullLineComments({
  project,
  number,
  path,
  line,
  startLine,
  side,
  comments,
  composing,
  suggestionSeed,
  onCompose,
  onCancel,
  onPosted,
}: {
  project: string;
  number: number;
  path: string;
  /** The last line the comment covers — where this renders. */
  line: number;
  /** The first line, when the comment spans a range. */
  startLine?: number;
  side: "LEFT" | "RIGHT";
  comments: readonly PullComment[];
  composing: boolean;
  /** The current text of the covered lines, for seeding a suggestion. */
  suggestionSeed?: readonly string[];
  onCompose: (target: CommentTarget) => void;
  onCancel: () => void;
  onPosted: () => void;
}) {
  const [target, setTarget] = React.useState<CommentTarget>({ kind: "new" });

  if (comments.length === 0 && !composing) return null;

  const makeComposer = (embedded: boolean, replyTarget?: CommentTarget) => (
    <Composer
      project={project}
      number={number}
      path={path}
      line={line}
      startLine={startLine}
      side={side}
      suggestionSeed={suggestionSeed}
      target={replyTarget ?? { kind: "new" }}
      embedded={embedded}
      onCancel={() => {
        setTarget({ kind: "new" });
        onCancel();
      }}
      onPosted={() => {
        setTarget({ kind: "new" });
        onPosted();
      }}
    />
  );

  return (
    <div className="px-2.5 py-2 font-sans">
      <div className="flex max-w-[80ch] flex-col gap-2">
        {comments.map((comment) => {
          const replyingHere = target.kind === "reply" && target.threadId === comment.threadId;
          return (
            <PullThreadCard
              key={comment.id}
              path={path}
              line={startLine !== undefined && startLine !== line ? `${startLine}–${line}` : line}
              url={comment.url}
              resolved={comment.resolved}
              root={comment}
              // The reply box lives in the thread's own foot — a box floating
              // below the cards made "where will this go" a guess.
              footer={replyingHere ? makeComposer(true, target) : undefined}
              onReply={
                comment.threadId && !replyingHere
                  ? () => {
                      setTarget({ kind: "reply", threadId: comment.threadId ?? "" });
                      onCompose({ kind: "reply", threadId: comment.threadId ?? "" });
                    }
                  : undefined
              }
            />
          );
        })}
        {composing && target.kind === "new" && makeComposer(false)}
      </div>
    </div>
  );
}

function Composer({
  project,
  number,
  path,
  line,
  startLine,
  side,
  suggestionSeed,
  target,
  embedded,
  onCancel,
  onPosted,
}: {
  project: string;
  number: number;
  path: string;
  line: number;
  startLine?: number;
  side: "LEFT" | "RIGHT";
  suggestionSeed?: readonly string[];
  target: CommentTarget;
  /** Inside a thread card's foot: the card already draws the frame. */
  embedded?: boolean;
  onCancel: () => void;
  onPosted: () => void;
}) {
  const [body, setBody] = React.useState("");
  const [posting, setPosting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const area = React.useRef<HTMLTextAreaElement>(null);

  /**
   * Grow with the text, up to a cap.
   *
   * A fixed two-line box is the wrong default for a review comment, and it was
   * actively broken for "Suggest": that seeds the whole selected range at once
   * and the proposal you are supposed to edit sat clipped inside 64px. Growing
   * removes the reason for a manual resize handle, so there isn't one.
   */
  React.useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  // GitHub applies a suggestion to the post-image, so there is nothing to
  // propose against a line that was removed, and nothing to seed it with
  // unless the patch actually showed the lines.
  const canSuggest =
    target.kind === "new" &&
    side === "RIGHT" &&
    (suggestionSeed?.length ?? 0) > 0 &&
    !hasSuggestion(body);

  const submit = async () => {
    const text = body.trim();
    if (!text || posting) return;
    setPosting(true);
    setError(null);
    try {
      if (target.kind === "reply") {
        await daemon.postPullComment(project, number, text, target.threadId);
      } else {
        await daemon.createPullReviewComment(project, number, {
          body: text,
          line,
          path,
          side,
          // A one-line comment sends no range; the daemon rejects a span whose
          // start is its end.
          ...(startLine !== undefined && startLine !== line ? { startLine, startSide: side } : {}),
        });
      }
      setBody("");
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        !embedded && "overflow-hidden rounded-md border border-border/70 bg-card p-2.5",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {target.kind === "reply"
            ? `Replying in thread on ${path}`
            : `Commenting on ${path}:${
                startLine !== undefined && startLine !== line ? `${startLine}–${line}` : line
              }`}
        </p>
        {canSuggest && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
            title="Propose a replacement for these lines"
            onClick={() => setBody((current) => appendSuggestion(current, suggestionSeed ?? []))}
          >
            <Lightbulb className="size-3" />
            Suggest
          </Button>
        )}
      </div>
      <Textarea
        ref={area}
        autoFocus
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
            return;
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder="Leave a comment… (⌘⏎ to post)"
        aria-label="Comment body"
        className="max-h-80 min-h-24 resize-none overflow-y-auto border-border/60 bg-background/40 text-sm"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center justify-end gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 px-2.5 text-xs"
          disabled={!body.trim() || posting}
          onClick={() => void submit()}
        >
          {posting && <Loader2 className="size-3.5 animate-spin" />}
          Comment
        </Button>
      </div>
    </div>
  );
}

const SUGGESTION_FENCE = "```suggestion";

function hasSuggestion(body: string): boolean {
  return body.includes(SUGGESTION_FENCE);
}

/**
 * Append a suggestion block seeded with the lines as they stand.
 *
 * GitHub reads a fenced ```suggestion block as a replacement for exactly the
 * commented range and offers an "Apply" button on it, so the block has to
 * start as the current text — a reviewer edits a proposal, they do not retype
 * the file.
 */
function appendSuggestion(body: string, seed: readonly string[]): string {
  const block = [SUGGESTION_FENCE, ...seed, "```"].join("\n");
  const trimmed = body.trimEnd();
  return trimmed ? `${trimmed}\n\n${block}` : block;
}
