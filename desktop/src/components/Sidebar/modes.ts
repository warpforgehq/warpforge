import { CalendarClock, Hammer, Inbox, ListTree, type LucideIcon } from "lucide-react";

import type { SidebarMode } from "@/store/ui";

/** The rail's modes, in order. Each switches the sidebar panel and the main
 *  area; ⌥⌘1–4 pick them. */
export const SIDEBAR_MODES: { id: SidebarMode; label: string; icon: LucideIcon; key: string }[] = [
  { icon: ListTree, id: "tasks", key: "1", label: "Tasks" },
  { icon: Inbox, id: "inbox", key: "2", label: "Inbox" },
  { icon: Hammer, id: "team", key: "3", label: "Smiths" },
  { icon: CalendarClock, id: "automations", key: "4", label: "Automations" },
];

/** The panel the modes address, for `aria-controls`. */
export const SIDEBAR_BODY_ID = "sidebar-body";

/** What the rail marks as selected: Settings while they are open, else the mode. */
export type RailSelection = SidebarMode | "settings";

export function railSelection(mode: SidebarMode, settingsOpen: boolean): RailSelection {
  return settingsOpen ? "settings" : mode;
}
