import { Brain, CalendarClock, LayoutGrid } from "lucide-react";

import type { GlobalView } from "@/store/ui";

/** Views: they change the main area only. Tasks, Inbox and Smiths are modes
 *  (`modes.ts`), because they also change the sidebar body. */
export const NAV: {
  id: GlobalView;
  label: string;
  icon: typeof LayoutGrid;
  attention?: boolean;
}[] = [
  { attention: true, icon: LayoutGrid, id: "control", label: "Mission Control" },
  { icon: CalendarClock, id: "automations", label: "Automations" },
  { icon: Brain, id: "memory", label: "Memory" },
];
