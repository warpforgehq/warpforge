import { ArrowDownLeft, ArrowUpRight, ChevronRight, Users } from "lucide-react";
import { useState } from "react";

import { peerMessageHeading } from "@/lib/peerMessageHeading";
import { cn } from "@/lib/utils";
import type { SessionUpdate } from "@/protocol";

type PeerMessage = Extract<SessionUpdate, { kind: "peer_message" }>;

const CLAMP_LINES = 3;
const CLAMP_CHARS = 240;

/**
 * One message exchanged with another task's agent, as a compact attributed line.
 * @param update the transcript entry
 * @param compact render a single truncated line for mission-control tiles
 * @param onOpenTask opens the other task
 * @returns the message line
 */
export function PeerMessageLine({
  compact,
  onOpenTask,
  update,
}: {
  compact?: boolean;
  onOpenTask?: (id: string) => void;
  update: PeerMessage;
}) {
  const [expanded, setExpanded] = useState(false);
  const { title, target } = peerMessageHeading(update);
  const Icon =
    update.direction === "sent"
      ? ArrowUpRight
      : update.direction === "received"
        ? ArrowDownLeft
        : Users;
  const clampable =
    update.text.length > CLAMP_CHARS || update.text.split("\n").length > CLAMP_LINES;

  if (compact) {
    return (
      <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5 shrink-0 text-primary" />
        <span className="shrink-0 text-foreground">{title}:</span>
        <span className="min-w-0 truncate">{update.text}</span>
      </p>
    );
  }

  return (
    <section
      aria-label="Peer message"
      className="min-w-0 rounded-lg border border-border bg-secondary/20 px-3 py-2 text-muted-foreground"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0 text-primary" />
        {target && onOpenTask ? (
          <button
            type="button"
            onClick={() => onOpenTask(target.id)}
            className="group flex min-w-0 items-center gap-1 rounded text-[13px] font-semibold text-foreground hover:text-primary"
            aria-label={`Open ${target.label} task`}
          >
            <span className="truncate">{title}</span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </button>
        ) : (
          <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">
            {title}
          </span>
        )}
      </div>
      <p
        className={cn(
          "mt-1 whitespace-pre-wrap break-words text-sm text-foreground",
          clampable && !expanded && "line-clamp-3",
        )}
      >
        {update.text}
      </p>
      {clampable && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </section>
  );
}
