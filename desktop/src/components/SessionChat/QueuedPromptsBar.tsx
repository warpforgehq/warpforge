import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { QueuedPrompt } from "@/protocol";

import { daemon } from "../../daemon";

const LABEL: Record<QueuedPrompt["initiator"], string> = {
  automation: "Scheduled run",
  system: "Warpforge",
  user: "You",
};

/**
 * Messages the daemon is holding until the agent finishes its turn. They are
 * not in the conversation yet — this stack is the only place they exist, so it
 * shows each one in full rather than a count.
 *
 * The action stops the running turn and hands the agent every waiting message
 * at once, joined in order into one prompt — so it is session-level, never per
 * message.
 */
export function QueuedPromptsBar({ taskId, queued }: { taskId: string; queued: QueuedPrompt[] }) {
  const [sending, setSending] = useState(false);

  const sendNow = useCallback(async () => {
    setSending(true);
    try {
      await daemon.request("session.interrupt", { task_id: taskId });
    } catch (cause) {
      // The daemon refuses when the queue drained first, which is exactly the
      // case where silence would read as a dead button.
      toast.error(cause instanceof Error ? cause.message : "Could not send the waiting messages");
    } finally {
      setSending(false);
    }
  }, [taskId]);

  if (queued.length < 1) return null;

  return (
    <div className="shrink-0 px-2 pt-1.5">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
        <div className="flex items-center justify-between gap-2 pb-1.5">
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
            {queued.length === 1
              ? "1 message waiting for the agent"
              : `${queued.length} messages waiting for the agent`}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 border-amber-500/40 px-2 text-xs"
            disabled={sending}
            onClick={sendNow}
          >
            {queued.length === 1 ? "Send now" : "Send all now"}
          </Button>
        </div>
        <ul className="space-y-1">
          {queued.map((message) => (
            <li
              key={message.id}
              className="rounded-md border border-border/60 bg-background/70 px-2 py-1 text-xs"
            >
              {message.initiator !== "user" && (
                <div className="pb-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {LABEL[message.initiator]}
                </div>
              )}
              <p className="line-clamp-3 whitespace-pre-wrap break-words">{message.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
