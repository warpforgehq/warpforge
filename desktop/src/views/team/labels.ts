import type { BadgeProps } from "@/lib/badgeVariants";
import { USER_LABEL, peerLabel } from "@/lib/peerFeed";
import type { PeerMessage, PeerMessageStatus, Smith, TaskInfo } from "@/protocol";

export const STATUS_META: Record<
  PeerMessageStatus,
  { label: string; badge: BadgeProps["variant"] }
> = {
  delivered: { badge: "ok", label: "Delivered" },
  held: { badge: "warn", label: "Held" },
  posted: { badge: "outline", label: "Posted" },
  queued: { badge: "default", label: "Queued" },
  refused: { badge: "destructive", label: "Refused" },
};

/** Why a held message has not arrived yet. */
export const HELD_HINT = "The session is not running; it reads this when it is next resumed.";

/** How the feed names a session that is gone and left no label. */
export const DELETED_LABEL = "deleted session";

/**
 * @param tasks the snapshot's tasks by id
 * @param smiths the Smiths by id
 * @param records feed records, whose stored labels name sessions that are gone
 * @returns names a task id: the label a record stored for it, else the live
 *   task's, else "deleted session"
 */
export function labeller(
  tasks: ReadonlyMap<string, TaskInfo>,
  smiths: Readonly<Record<string, Smith>> = {},
  records: Iterable<PeerMessage> = [],
) {
  const stored = new Map<string, { id: number; label: string }>();
  const keep = (task: string | undefined, label: string | undefined, id: number) => {
    if (!task || !label) return;
    const known = stored.get(task);
    if (!known || known.id < id) stored.set(task, { id, label });
  };
  for (const record of records) {
    keep(record.fromTask, record.fromLabel, record.id);
    keep(record.toTask, record.toLabel, record.id);
  }
  return (id: string | null | undefined): string => {
    if (!id) return USER_LABEL;
    const label = stored.get(id)?.label;
    if (label) return label;
    const task = tasks.get(id);
    return task ? peerLabel(task, smiths) : DELETED_LABEL;
  };
}

const SHORT_LABEL = 28;

/**
 * A label short enough for a list row or a button; the full one goes in its
 * tooltip.
 * @param label a session's label
 * @returns it, cut to a few words
 */
export function shortLabel(label: string): string {
  const chars = Array.from(label);
  return chars.length > SHORT_LABEL ? `${chars.slice(0, SHORT_LABEL - 1).join("")}…` : label;
}

/** A user's channel post, the only kind a session can be started from. */
export function isUserPost(record: PeerMessage): boolean {
  return !record.fromTask && !record.toTask && !record.startedTask && record.status === "posted";
}

/**
 * @param seconds unix seconds
 * @param now the current time in milliseconds
 * @returns a short time: "14:05" today, "Oct 12" otherwise
 */
export function feedTime(seconds: number, now = Date.now()): string {
  const date = new Date(seconds * 1000);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  return new Intl.DateTimeFormat(
    "en-US",
    sameDay ? { timeStyle: "short" } : { dateStyle: "medium" },
  ).format(date);
}
