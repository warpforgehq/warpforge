import type { BadgeProps } from "@/lib/badgeVariants";
import { USER_LABEL } from "@/lib/peerFeed";
import { taskLabel } from "@/lib/taskLabel";
import type { PeerMessage, PeerMessageStatus, TaskInfo } from "@/protocol";

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

/**
 * @param tasks the snapshot's tasks by id
 * @returns names a task id, falling back to the id once the task is gone
 */
export function labeller(tasks: ReadonlyMap<string, TaskInfo>) {
  return (id: string | null | undefined): string => {
    if (!id) return USER_LABEL;
    const task = tasks.get(id);
    return task ? taskLabel(task).split("\n")[0]!.trim() : id;
  };
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
