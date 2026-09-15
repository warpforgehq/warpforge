import { Inbox, ListTree, type LucideIcon } from "lucide-react";

import type { View } from "@/store/ui";

/** Which half of the sidebar body is showing: the project → task tree, or the
 *  pull-request queue. Two segments, not a tab per destination — a fourth
 *  destination must not cost a fourth tab. */
export type SidebarSegment = "tasks" | "inbox";

export const SEGMENTS: { id: SidebarSegment; label: string; icon: LucideIcon }[] = [
  { icon: ListTree, id: "tasks", label: "Tasks" },
  { icon: Inbox, id: "inbox", label: "Inbox" },
];

/**
 * The segment as a reading of where the app already is, never a second source
 * of truth. A task takes the column from the inbox, so it reads as Tasks even
 * while `view` is still the inbox it was opened from.
 *
 * @param view The route the app is on.
 * @param openTaskId The open task, if any.
 * @returns The segment the sidebar body is showing.
 */
export function sidebarSegment(view: View, openTaskId: string | null): SidebarSegment {
  return view === "inbox" && !openTaskId ? "inbox" : "tasks";
}
