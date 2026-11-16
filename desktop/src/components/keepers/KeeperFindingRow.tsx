import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBusy } from "@/hooks/useBusy";
import { cn } from "@/lib/utils";
import type { KeeperFinding, KeeperReplyVerdict, KeeperSeverity } from "@/protocol";

const SEVERITY_TONE: Record<KeeperSeverity, string> = {
  critical: "border-destructive/50 bg-destructive/15 text-destructive",
  high: "border-destructive/30 bg-destructive/10 text-destructive",
  low: "border-border bg-secondary/40 text-muted-foreground",
  medium: "border-warn/30 bg-warn/10 text-warn",
};

const REPLY_LABEL: Record<KeeperReplyVerdict, string> = {
  rebutted: "rebutted",
  stale: "no longer holds",
};

/**
 * One finding: severity, a `file:line` link into the Explorer, the agent's
 * answer with Accept when it left the finding unfixed, and Dismiss with an
 * optional reason.
 * @param finding The finding.
 * @param onOpenFile Opens a path at a line in the Explorer.
 * @param onDismiss Dismisses the finding with the reason typed, if any.
 * @param onAccept Accepts the agent's answer.
 * @returns The row.
 */
export function KeeperFindingRow({
  finding,
  onAccept,
  onDismiss,
  onOpenFile,
}: {
  finding: KeeperFinding;
  onAccept: () => Promise<void>;
  onDismiss: (reason: string) => Promise<void>;
  onOpenFile: (path: string, location?: { line?: number }) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, run] = useBusy();
  const file = finding.file;
  const reply = finding.reply;

  const accept = () => run(onAccept);

  const dismiss = () =>
    run(async () => {
      await onDismiss(reason);
      setAsking(false);
    });

  return (
    <li className="flex flex-col gap-1.5 border-t border-border/60 py-2 first:border-t-0">
      <div className="flex min-w-0 items-start gap-2">
        <span
          className={cn(
            "shrink-0 rounded border px-1.5 py-px text-[10px] font-medium uppercase",
            SEVERITY_TONE[finding.severity],
          )}
        >
          {finding.severity}
        </span>
        <div className="min-w-0 flex-1">
          {file && (
            <button
              type="button"
              className="block max-w-full truncate font-mono text-xs text-primary hover:underline"
              onClick={() => onOpenFile(file, { line: finding.line ?? undefined })}
            >
              {finding.line ? `${file}:${finding.line}` : file}
            </button>
          )}
          <p className="text-[13px] whitespace-pre-wrap break-words text-foreground">
            {finding.description}
          </p>
          {reply && (
            <p className="text-xs whitespace-pre-wrap break-words text-muted-foreground">
              Agent: {REPLY_LABEL[reply.verdict]} — {reply.reason}
            </p>
          )}
        </div>
        {reply && !asking && (
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0"
            disabled={busy}
            onClick={() => void accept()}
          >
            Accept
          </Button>
        )}
        {!asking && (
          <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setAsking(true)}>
            Dismiss
          </Button>
        )}
      </div>
      {asking && (
        <form
          className="flex items-center gap-1.5 pl-2"
          onSubmit={(event) => {
            event.preventDefault();
            void dismiss();
          }}
        >
          <Input
            autoFocus
            aria-label="Why dismiss (optional)"
            placeholder="Why it is not a problem (optional)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="h-7 text-[13px]"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={busy}>
            Dismiss
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(false)}>
            Cancel
          </Button>
        </form>
      )}
    </li>
  );
}
