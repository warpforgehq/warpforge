import { CalendarClock, LayoutGrid } from "lucide-react";

import type { GlobalView } from "@/store/ui";

/** Global destinations that are not the sidebar body. The inbox is not here:
 *  it is a body segment, because it replaces the tree rather than the pane. */
export const NAV: {
  id: GlobalView;
  label: string;
  icon: typeof LayoutGrid;
  attention?: boolean;
}[] = [
  { attention: true, icon: LayoutGrid, id: "control", label: "Mission Control" },
  { icon: CalendarClock, id: "automations", label: "Automations" },
];
