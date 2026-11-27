import {
  FolderTree,
  GitBranch,
  GitPullRequest,
  ListTodo,
  type LucideIcon,
  Server,
  TerminalSquare,
} from "lucide-react";

import type { ProjectSurface } from "@/store/ui";

/** A project's sections, in the order the panel lists them. */
export const PROJECT_SECTIONS: readonly { id: ProjectSurface; label: string; icon: LucideIcon }[] =
  [
    { id: "backlog", label: "Backlog", icon: ListTodo },
    { id: "pulls", label: "Pull requests", icon: GitPullRequest },
    { id: "files", label: "Explorer", icon: FolderTree },
    { id: "runtime", label: "Runtime", icon: Server },
    { id: "terminal", label: "Terminal", icon: TerminalSquare },
    { id: "worktrees", label: "Worktrees", icon: GitBranch },
  ];

/**
 * The label of a project section.
 * @param id the section
 * @returns its sentence-case label
 */
export function sectionLabel(id: ProjectSurface): string {
  return PROJECT_SECTIONS.find((section) => section.id === id)?.label ?? "Backlog";
}
