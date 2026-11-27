import { Bell, Bot, Brain, ListChecks, Palette, Plug, Wrench, type LucideIcon } from "lucide-react";

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
        description: "Install, update and sign in to agents, and choose the models they offer.",
        icon: Bot,
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
