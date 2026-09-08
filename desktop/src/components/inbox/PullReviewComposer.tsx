import { Loader2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { daemon } from "@/daemon";

export type ReviewVerdict = "APPROVE" | "REQUEST_CHANGES";

/**
 * The summary that rides a review verdict.
 *
 * An approval can go out without a word; requesting changes cannot — the
 * submit stays disabled until there is something to act on, because "changes
 * requested" with an empty body is a blocked pull request and no reason.
 * The verdict posts straight to GitHub: the inbox does not model a pending
 * draft review (ADR-0010).
 */
export function PullReviewComposer({
  project,
  number,
  verdict,
  onClose,
  onSubmitted,
}: {
  project: string;
  number: number;
  verdict: ReviewVerdict;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [body, setBody] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const approving = verdict === "APPROVE";
  const ready = approving || !!body.trim();

  const submit = React.useCallback(async () => {
    if (pending || !ready) return;
    setPending(true);
    setError(null);
    try {
      await daemon.pullReview(project, number, verdict, body);
      setBody("");
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }, [body, number, onSubmitted, pending, project, ready, verdict]);

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-border/70 px-3 py-2">
      <textarea
        autoFocus
        rows={3}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          // A keyboard submit like every other composer; Enter stays a
          // newline because a summary is prose.
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            if (!pending) onClose();
          }
        }}
        placeholder={
          approving ? "Summary (optional) — what did you check?" : "What needs to change?"
        }
        aria-label={approving ? "Approval summary" : "Explain what needs to change"}
        className="min-h-[3rem] w-full resize-y rounded-md border border-border bg-background/50 px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:border-border focus-visible:outline-none"
      />
      <div className="flex min-w-0 items-center gap-2">
        {error && <span className="min-w-0 flex-1 truncate text-xs text-destructive">{error}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-xs"
            disabled={pending || !ready}
            onClick={() => void submit()}
          >
            {pending && <Loader2 className="size-3 animate-spin" aria-hidden />}
            {approving ? "Approve" : "Request changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
