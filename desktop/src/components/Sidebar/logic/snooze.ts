import type { TaskInfo } from "@/protocol";

function isValidStamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** A snooze only counts while both of its stamps survived the round trip. */
export function isSnoozed(task: TaskInfo, nowSec: number): boolean {
  return (
    isValidStamp(task.snoozedAt) && isValidStamp(task.snoozedUntil) && task.snoozedUntil > nowSec
  );
}

/** Compact "comes back in" label for a snoozed row: the row's whole story. */
export function snoozeWakeLabel(untilSec: number, nowSec: number): string {
  const seconds = Math.max(0, untilSec - nowSec);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
