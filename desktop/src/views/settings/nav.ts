import {
  Bell,
  Bot,
  Brain,
  Cpu,
  ListChecks,
  Palette,
  Plug,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { SettingsPage } from "@/store/ui";

interface SectionLink {
  id: SettingsPage;
  label: string;
  icon: LucideIcon;
}

export const SETTINGS_GROUPS: { label: string; pages: SectionLink[] }[] = [
  {
    label: "Personal",
    pages: [
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Agents",
    pages: [
      { id: "agents", label: "Agents & accounts", icon: Bot },
      { id: "models", label: "Models", icon: Cpu },
      { id: "tasks", label: "Tasks", icon: ListChecks },
    ],
  },
  { label: "Workspace", pages: [{ id: "integrations", label: "Integrations", icon: Plug }] },
  {
    label: "System",
    pages: [
      { id: "memory", label: "Memory", icon: Brain },
      { id: "advanced", label: "Advanced", icon: Wrench },
    ],
  },
];

export const SETTINGS_PAGES = SETTINGS_GROUPS.flatMap((group) => group.pages);
