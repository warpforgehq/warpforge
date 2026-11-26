import { CalendarClock, type LucideIcon } from "lucide-react";

import type { GlobalView } from "@/store/ui";

/** Views that change only the main area, offered in the rail below the
 *  modes (`modes.ts`). Memory lives in Settings. */
export const NAV: { id: GlobalView; label: string; icon: LucideIcon }[] = [
  { icon: CalendarClock, id: "automations", label: "Automations" },
];
