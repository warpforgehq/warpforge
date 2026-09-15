import {
  AlarmClock,
  Check,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock,
  Eye,
  MessageCircleQuestion,
  Unplug,
  type LucideIcon,
} from "lucide-react";

import type { SidebarStateIcon } from "./logic";

/** One lucide mark per sidebar state; the glyph lane and tooltip share it. */
export const STATE_ICON: Record<SidebarStateIcon, LucideIcon> = {
  blocked: CircleAlert,
  done: CircleCheck,
  failed: Unplug,
  idle: Circle,
  needs_answer: MessageCircleQuestion,
  queued: Clock,
  review: Eye,
  settled: Check,
  snoozed: AlarmClock,
  working: CircleDashed,
};
