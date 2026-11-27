import {
  FolderTree,
  GitBranch,
  GitPullRequest,
  ListTodo,
  type LucideIcon,
  Server,
  SlidersHorizontal,
  TerminalSquare,
} from "lucide-react";

import { resolveSection, visibleSections } from "@/lib/projectSections";
import { type ProjectSurface, useUi } from "@/store/ui";

/** A project's sections, in the built-in order. */
export const PROJECT_SECTIONS: readonly { id: ProjectSurface; label: string; icon: LucideIcon }[] =
  [
    { id: "backlog", label: "Backlog", icon: ListTodo },
    { id: "pulls", label: "Pull requests", icon: GitPullRequest },
    { id: "files", label: "Explorer", icon: FolderTree },
    { id: "runtime", label: "Runtime", icon: Server },
    { id: "terminal", label: "Terminal", icon: TerminalSquare },
    { id: "worktrees", label: "Worktrees", icon: GitBranch },
    { id: "config", label: "Config", icon: SlidersHorizontal },
  ];

/**
 * The label of a project section.
 * @param id the section
 * @returns its sentence-case label
 */
export function sectionLabel(id: ProjectSurface): string {
  return PROJECT_SECTIONS.find((section) => section.id === id)?.label ?? "Backlog";
}

/**
 * The sections the panel lists, in the user's order.
 * @returns label and icon of each visible section
 */
export function useVisibleSections() {
  const prefs = useUi((state) => state.projectSections);
  return visibleSections(prefs).map((id) => PROJECT_SECTIONS.find((section) => section.id === id)!);
}

/**
 * The section a project shows: its remembered one unless hidden, else the first visible.
 * @param project the project name
 * @returns the section to render
 */
export function useProjectSection(project: string): ProjectSurface {
  const remembered = useUi((state) => state.projectSurfaceByProject[project]);
  const prefs = useUi((state) => state.projectSections);
  return resolveSection(remembered, prefs);
}
