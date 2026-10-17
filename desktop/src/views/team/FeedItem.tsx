import { AlertTriangle, ArrowRight, Play } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PeerMessage } from "@/protocol";

import { HELD_HINT, STATUS_META, feedTime, isUserPost } from "./labels";

interface Props {
  record: PeerMessage;
  label: (id: string | null | undefined) => string;
  onOpenTask: (id: string) => void;
  /** Offered on the user's own channel posts. */
  onStartSession?: (record: PeerMessage) => void;
}

function TaskLink({
  id,
  label,
  onOpenTask,
}: {
  id: string | undefined;
  label: (id: string | null | undefined) => string;
  onOpenTask: (id: string) => void;
}): ReactNode {
  if (!id) return <span className="font-medium text-foreground">{label(id)}</span>;
  return (
    <button
      type="button"
      onClick={() => onOpenTask(id)}
      className="min-w-0 truncate font-medium text-foreground hover:text-primary hover:underline"
    >
      {label(id)}
    </button>
  );
}

/** One feed record: who sent it to whom, its text, and where it stands. */
export function FeedItem({ record, label, onOpenTask, onStartSession }: Props) {
  const meta = STATUS_META[record.status] ?? STATUS_META.refused;
  if (record.startedTask) {
    return (
      <li className="flex items-center gap-1.5 px-1 py-1 text-[13px] text-muted-foreground">
        <Play aria-hidden className="size-3.5 shrink-0" />
        <span>{label(record.fromTask)} started</span>
        <TaskLink id={record.startedTask} label={label} onOpenTask={onOpenTask} />
        <span className="ml-auto shrink-0 text-xs">{feedTime(record.createdAt)}</span>
      </li>
    );
  }
  const reason =
    record.status === "refused" ? record.reason : record.status === "held" ? HELD_HINT : undefined;
  return (
    <li className="group space-y-1 rounded-md px-1 py-1.5">
      <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
        <TaskLink id={record.fromTask} label={label} onOpenTask={onOpenTask} />
        {record.toTask && (
          <>
            <ArrowRight aria-hidden className="size-3 shrink-0" />
            <TaskLink id={record.toTask} label={label} onOpenTask={onOpenTask} />
          </>
        )}
        <span className="shrink-0 text-xs">{feedTime(record.createdAt)}</span>
        {record.status !== "posted" && (
          <Badge variant={meta.badge} className="shrink-0">
            {meta.label}
          </Badge>
        )}
        {record.alert && record.alertClearedAt == null && (
          <AlertTriangle
            aria-label="Message limit reached"
            className="size-3.5 shrink-0 text-warn"
          />
        )}
        {onStartSession && isUserPost(record) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-6 shrink-0 px-2 text-xs opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            onClick={() => onStartSession(record)}
          >
            Start a session
          </Button>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm text-foreground">{record.text}</p>
      {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
      {record.mentions && record.mentions.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span>{record.fromTask ? "Messaged" : "Handed to"}</span>
          {record.mentions.map((id) => (
            <TaskLink key={id} id={id} label={label} onOpenTask={onOpenTask} />
          ))}
        </p>
      )}
    </li>
  );
}
