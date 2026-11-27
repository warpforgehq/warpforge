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
  /** One line under the page title. */
  description: string;
  icon: LucideIcon;
}

export const SETTINGS_GROUPS: { label: string; pages: SectionLink[] }[] = [
  {
    label: "Personal",
    pages: [
      {
        id: "appearance",
        label: "Appearance",
        description: "Theme, text size and window glass.",
        icon: Palette,
      },
      {
        id: "notifications",
        label: "Notifications",
        description: "Choose which events interrupt you, and how.",
        icon: Bell,
      },
    ],
  },
  {
    label: "Agents",
    pages: [
      {
        id: "agents",
        label: "Agents & accounts",
        description: "Install, update and sign in to the coding agents Warpforge runs.",
        icon: Bot,
      },
      {
        id: "models",
        label: "Models",
        description: "Pick which models each agent offers, and add your own.",
        icon: Cpu,
      },
      {
        id: "tasks",
        label: "Tasks",
        description: "Confirmations, generated text and how long finished work is kept.",
        icon: ListChecks,
      },
    ],
  },
  {
    label: "Workspace",
    pages: [
      {
        id: "integrations",
        label: "Integrations",
        description: "Language servers and issue trackers.",
        icon: Plug,
      },
    ],
  },
  {
    label: "System",
    pages: [
      {
        id: "memory",
        label: "Memory",
        description: "What agents remember across sessions, and how it is searched.",
        icon: Brain,
      },
      {
        id: "advanced",
        label: "Advanced",
        description: "Storage and maintenance for power users.",
        icon: Wrench,
      },
    ],
  },
];

export const SETTINGS_PAGES = SETTINGS_GROUPS.flatMap((group) => group.pages);
