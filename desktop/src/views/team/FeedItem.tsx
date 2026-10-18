import { AlertTriangle, ArrowRight, Play } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { CollapsibleMarkdown } from "@/components/Markdown";
import { SmithAvatar } from "@/components/SmithAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type MentionLook, remarkMentions } from "@/lib/markdownMentions";
import type { MentionCandidate } from "@/lib/peerFeed";
import { smithColor } from "@/lib/smithColors";
import { cn } from "@/lib/utils";
import type { PeerMessage } from "@/protocol";

import { HELD_HINT, STATUS_META, feedTime, isUserPost } from "./labels";

interface Props {
  record: PeerMessage;
  label: (id: string | null | undefined) => string;
  onOpenTask: (id: string) => void;
  /** Offered on the user's own channel posts. */
  onStartSession?: (record: PeerMessage) => void;
  /** The Smith whose thread sent the record. */
  smith?: { id: string; name: string };
  /** Who an `@mention` in the text can name, highlighted when it does. */
  mentions?: MentionCandidate[];
  /** The palette index of the Smith a thread task belongs to. */
  smithColorOf?: (taskId: string) => number | undefined;
  /** It continues the post above from the same sender: no header. */
  continued?: boolean;
}

const SESSION_MENTION = "rounded bg-secondary px-1 font-medium text-foreground";
const SMITH_MENTION = "rounded px-1 font-medium";
const AUTHOR = "text-sm font-semibold";

function TaskLink({
  id,
  label,
  onOpenTask,
  className = "font-medium",
}: {
  id: string | undefined;
  label: (id: string | null | undefined) => string;
  onOpenTask: (id: string) => void;
  className?: string;
}): ReactNode {
  if (!id) return <span className={cn("text-foreground", className)}>{label(id)}</span>;
  return (
    <button
      type="button"
      onClick={() => onOpenTask(id)}
      className={cn(
        "min-w-0 truncate text-foreground hover:text-primary hover:underline",
        className,
      )}
    >
      {label(id)}
    </button>
  );
}

/** One feed record: who sent it to whom, its text, and where it stands. */
export function FeedItem({
  record,
  label,
  onOpenTask,
  onStartSession,
  smith,
  mentions,
  smithColorOf,
  continued = false,
}: Props) {
  const plugins = useMemo(() => {
    if (!mentions?.length) return undefined;
    const look = (candidate: MentionCandidate): MentionLook => {
      const index = candidate.smith ? smithColorOf?.(candidate.id) : undefined;
      if (index === undefined) return { className: SESSION_MENTION };
      return {
        className: SMITH_MENTION,
        style: `color: ${smithColor(index)}; background-color: ${smithColor(index, 0.15)}`,
      };
    };
    return [remarkMentions(mentions, look)];
  }, [mentions, smithColorOf]);
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
    <li
      className={cn(
        "group relative space-y-1 rounded-md px-2 py-1 transition-colors hover:bg-secondary/40",
        continued ? "mt-0" : "mt-3 first:mt-0",
      )}
    >
      {!continued && (
        <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
          {smith && <SmithAvatar smith={smith} size="size-5" />}
          <TaskLink id={record.fromTask} label={label} onOpenTask={onOpenTask} className={AUTHOR} />
          {record.toTask && (
            <>
              <ArrowRight aria-hidden className="size-3 shrink-0" />
              <TaskLink
                id={record.toTask}
                label={label}
                onOpenTask={onOpenTask}
                className={AUTHOR}
              />
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
        </div>
      )}
      {onStartSession && isUserPost(record) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="absolute right-1 top-1 h-6 px-2 text-xs opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          onClick={() => onStartSession(record)}
        >
          Start a session
        </Button>
      )}
      <CollapsibleMarkdown className="text-sm text-foreground" remarkPlugins={plugins}>
        {record.text}
      </CollapsibleMarkdown>
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
