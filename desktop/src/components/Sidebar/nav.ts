import { CalendarClock, Inbox, LayoutGrid } from "lucide-react";

import type { GlobalView } from "@/store/ui";

export const NAV: {
  id: GlobalView;
  label: string;
  icon: typeof LayoutGrid;
  attention?: boolean;
}[] = [
  { attention: true, icon: LayoutGrid, id: "control", label: "Mission Control" },
  { attention: true, icon: Inbox, id: "inbox", label: "Inbox" },
  { icon: CalendarClock, id: "automations", label: "Automations" },
];
