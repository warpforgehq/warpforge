import { Pencil, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PromptAttachmentSummary, QueuedPrompt } from "@/protocol";

import { daemon } from "../../daemon";

const LABEL: Record<QueuedPrompt["initiator"], string> = {
  automation: "Scheduled run",
  peer: "Peer message",
  system: "Warpforge",
  user: "You",
};

/** The daemon's refusal when an edit or remove lost the race with the queue
 *  draining — the message is no longer a queue entry, so there is nothing to
 *  change. Shown as a short "Already sent" rather than the raw sentence. */
function isAlreadySent(cause: unknown): boolean {
  return cause instanceof Error && cause.message.includes("already sent");
}

function summaryLabel(attachment: PromptAttachmentSummary): string {
  switch (attachment.type) {
    case "file":
      return attachment.path;
    case "image":
      return attachment.name;
    case "document":
      return attachment.name;
  }
}

/**
 * Messages the daemon is holding until the agent finishes its turn. They are
 * not in the conversation yet — this stack is the only place they exist, so it
 * shows each one in full rather than a count.
 *
 * Each waiting message can be removed or rewritten while it waits; both fail
 * loudly if it went out first. The action on the right stops the running turn
 * and hands the agent every waiting message at once, joined in order into one
 * prompt — so it is session-level, never per message.
 */
export function QueuedPromptsBar({ taskId, queued }: { taskId: string; queued: QueuedPrompt[] }) {
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // A message that leaves the queue — dispatched, removed here, or removed
  // from another window — must not leave a stale editor open behind it.
  useEffect(() => {
    if (editing && !queued.some((message) => message.id === editing)) {
      setEditing(null);
    }
  }, [editing, queued]);

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

  const requeue = useCallback(
    async (message: QueuedPrompt) => {
      try {
        await daemon.request("session.prompt", {
          task_id: taskId,
          text: message.text,
          attachments: [],
        });
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "Could not put the message back");
      }
    },
    [taskId],
  );

  const remove = useCallback(
    async (message: QueuedPrompt) => {
      try {
        await daemon.request("session.removeQueued", {
          task_id: taskId,
          queued_id: message.id,
        });
      } catch (cause) {
        if (isAlreadySent(cause)) {
          toast.error("Already sent");
          return;
        }
        toast.error(cause instanceof Error ? cause.message : "Could not remove the message");
        return;
      }
      // Removing a peer message refuses it; re-sending its text as the user's own
      // would misattribute it, so there is no undo.
      toast.success(
        "Queued message removed",
        message.initiator === "peer"
          ? undefined
          : { action: { label: "Undo", onClick: () => void requeue(message) } },
      );
    },
    [requeue, taskId],
  );

  const save = useCallback(
    async (message: QueuedPrompt) => {
      try {
        await daemon.request("session.editQueued", {
          task_id: taskId,
          queued_id: message.id,
          text: draft,
        });
        setEditing(null);
      } catch (cause) {
        if (isAlreadySent(cause)) {
          toast.error("Already sent");
          setEditing(null);
          return;
        }
        toast.error(cause instanceof Error ? cause.message : "Could not save the message");
      }
    },
    [draft, taskId],
  );

  if (queued.length < 1) return null;
  // The daemon only edits and force-sends the user's own messages.
  const canSendNow = queued.some((message) => message.initiator === "user");

  return (
    <div className="shrink-0 px-2 pt-1.5">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
        <div className="flex items-center justify-between gap-2 pb-1.5">
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
            {queued.length === 1
              ? "1 message waiting for the agent"
              : `${queued.length} messages waiting for the agent`}
          </span>
          {canSendNow && (
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
          )}
        </div>
        <ul className="space-y-1">
          {queued.map((message) => {
            const open = editing === message.id;
            return (
              <li
                key={message.id}
                className="group rounded-md border border-border/60 bg-background/70 px-2 py-1 text-xs"
              >
                <div className="flex items-start gap-1">
                  <div className="min-w-0 flex-1">
                    {message.initiator !== "user" && (
                      <div className="pb-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {LABEL[message.initiator]}
                      </div>
                    )}
                    {open ? (
                      <Textarea
                        autoFocus
                        aria-label="Edit queued message"
                        className="min-h-0 resize-none text-xs"
                        rows={2}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setEditing(null);
                          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault();
                            void save(message);
                          }
                        }}
                      />
                    ) : (
                      <p className="line-clamp-3 whitespace-pre-wrap break-words">{message.text}</p>
                    )}
                    {message.attachments && message.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {message.attachments.map((attachment) => (
                          <span
                            key={`${attachment.type}:${summaryLabel(attachment)}`}
                            className="rounded border border-border/60 bg-muted/60 px-1 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {summaryLabel(attachment)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    {open ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-xs"
                          onClick={() => void save(message)}
                        >
                          Save
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-xs"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        {message.initiator === "user" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            aria-label="Edit queued message"
                            title="Edit"
                            onClick={() => {
                              setDraft(message.text);
                              setEditing(message.id);
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          aria-label="Remove queued message"
                          title="Remove"
                          onClick={() => void remove(message)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
