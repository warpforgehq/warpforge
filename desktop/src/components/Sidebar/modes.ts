import { Hammer, Inbox, ListTree, type LucideIcon } from "lucide-react";

import type { SidebarMode } from "@/store/ui";

/** The sidebar's modes, in order. Each switches the sidebar body and the main
 *  area; ⌥⌘1–3 pick them. */
export const SIDEBAR_MODES: { id: SidebarMode; label: string; icon: LucideIcon; key: string }[] = [
  { icon: ListTree, id: "tasks", key: "1", label: "Tasks" },
  { icon: Inbox, id: "inbox", key: "2", label: "Inbox" },
  { icon: Hammer, id: "team", key: "3", label: "Smiths" },
];

/** The body the modes address, for `aria-controls`. */
export const SIDEBAR_BODY_ID = "sidebar-body";
