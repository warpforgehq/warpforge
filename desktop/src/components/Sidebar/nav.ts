import { CalendarClock, FolderTree, Inbox, LayoutGrid } from "lucide-react";

import type { View } from "@/store/ui";

export const NAV: { id: View; label: string; icon: typeof LayoutGrid; attention?: boolean }[] = [
  { attention: true, icon: LayoutGrid, id: "control", label: "Mission Control" },
  { icon: FolderTree, id: "projects", label: "Projects" },
  { attention: true, icon: Inbox, id: "inbox", label: "Inbox" },
  { icon: CalendarClock, id: "automations", label: "Automations" },
];
