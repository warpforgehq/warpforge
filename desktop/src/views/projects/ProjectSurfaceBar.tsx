import { FolderTree, GitPullRequest, ListTodo, Server, TerminalSquare } from "lucide-react";

import { SurfaceTabs, type SurfaceTab } from "@/components/workspace";
import type { ProjectSurface } from "@/store/ui";

/**
 * The project page's surfaces, in the same bar the task workspace uses.
 */
export const PROJECT_SURFACE_TABS: readonly SurfaceTab<ProjectSurface>[] = [
  { id: "backlog", label: "Backlog", icon: ListTodo },
  { id: "pulls", label: "Pull Requests", icon: GitPullRequest },
  { id: "files", label: "Files", icon: FolderTree },
  { id: "runtime", label: "Runtime", icon: Server },
  { id: "terminal", label: "Terminal", icon: TerminalSquare },
];

export interface ProjectSurfaceBarProps {
  activeSurface: ProjectSurface;
  onSurfaceChange: (surface: ProjectSurface) => void;
  tabs?: readonly SurfaceTab<ProjectSurface>[];
}

export function ProjectSurfaceBar({
  activeSurface,
  onSurfaceChange,
  tabs = PROJECT_SURFACE_TABS,
}: ProjectSurfaceBarProps) {
  return (
    <div className="flex h-9 min-w-0 items-center border-b border-border/70">
      <SurfaceTabs
        aria-label="Project surfaces"
        value={activeSurface}
        onValueChange={onSurfaceChange}
        tabs={tabs}
      />
    </div>
  );
}
