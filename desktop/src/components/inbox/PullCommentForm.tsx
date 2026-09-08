import { Loader2, SendHorizontal } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { daemon } from "@/daemon";
import { cn } from "@/lib/utils";

/**
 * The box for saying something on a pull request: a reply into a review
 * thread when it carries a `threadId`, a conversation-level comment when it
 * does not. Both go to GitHub immediately — the inbox does not model a
 * pending review (ADR-0010).
 *
 * It grows with the text rather than offering a resize handle, and starts at
 * one line: a reply box that opens three lines tall reads as a form to fill
 * in rather than a place to say one sentence.
 */
export function PullCommentForm({
  project,
  number,
  threadId,
  placeholder,
  label,
  submitLabel = "Reply",
  autoFocus,
  onCancel,
  onPosted,
  className,
}: {
  project: string;
  number: number;
  /** The review thread a reply is addressed to; absent posts to the PR. */
  threadId?: string;
  placeholder: string;
  /** The accessible name of the text area. */
  label: string;
  submitLabel?: string;
  autoFocus?: boolean;
  /** Present when the box can be dismissed — Escape and Cancel both call it. */
  onCancel?: () => void;
  onPosted: () => void;
  className?: string;
}) {
  const [body, setBody] = React.useState("");
  const [posting, setPosting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const area = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  const submit = async () => {
    const text = body.trim();
    if (!text || posting) return;
    setPosting(true);
    setError(null);
    try {
      await daemon.postPullComment(project, number, text, threadId || undefined);
      setBody("");
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPosting(false);
    }
  };

  const empty = !body.trim();

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex min-w-0 items-end gap-1.5">
        <Textarea
          ref={area}
          autoFocus={autoFocus}
          rows={1}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && onCancel) {
              event.stopPropagation();
              onCancel();
              return;
            }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={placeholder}
          aria-label={label}
          className="max-h-64 min-h-8 flex-1 resize-none overflow-y-auto border-border/60 bg-background/40 py-1.5 text-sm"
        />
        {/* The send affordance stays visible but inert while there is nothing
            to send: a control that appears on the first keystroke moves the
            layout under the cursor. */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={submitLabel}
          title={`${submitLabel} (⌘⏎)`}
          disabled={empty || posting}
          onClick={() => void submit()}
        >
          {posting ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <SendHorizontal className="size-3.5" aria-hidden />
          )}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {onCancel && !empty && (
        <button
          type="button"
          className="self-start text-xs text-muted-foreground/70 hover:text-foreground"
          onClick={onCancel}
        >
          Cancel
        </button>
      )}
    </div>
  );
}
