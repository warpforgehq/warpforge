import { Check, ChevronDown, ChevronLeft, FolderGit2, Plus } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Snapshot } from "@/protocol";
import { DEFAULT_PROJECT_SURFACE, type ProjectSurface, useUi, type View } from "@/store/ui";
import { PROJECT_SECTIONS } from "@/views/projects/sections";
import { useProjectSectionStatus } from "@/views/projects/useProjectSectionStatus";

import { TaskTree } from "./TaskTree";
import type { useSidebarTree } from "./useSidebarTree";

interface Props {
  project: string;
  snapshot: Snapshot;
  tree: ReturnType<typeof useSidebarTree>;
  view: View;
  openTaskId: string | null;
  onOpenProject: (name: string, section?: ProjectSurface) => void;
  onOpenTask: (id: string) => void;
  onNewTask: (project?: string) => void;
  onAddProject: () => void;
  onSettleFinishedTurns?: (ids: string[]) => void;
}

const row =
  "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[0.8125rem] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * The Tasks panel narrowed to one project: its sections, then its tasks.
 * The back chevron returns the panel to every project.
 */
export function ProjectPanel({
  project,
  snapshot,
  tree,
  view,
  openTaskId,
  onOpenProject,
  onOpenTask,
  onNewTask,
  onAddProject,
  onSettleFinishedTurns,
}: Props) {
  const exitPanelScope = useUi((s) => s.exitPanelScope);
  const surface = useUi((s) => s.projectSurfaceByProject[project] ?? DEFAULT_PROJECT_SURFACE);
  const status = useProjectSectionStatus(project, snapshot);
  const onSection = view === "project" && !openTaskId;

  return (
    <>
      <div
        data-tauri-drag-region="deep"
        className="flex h-10 shrink-0 items-center gap-0.5 pl-5 pr-3 pt-2"
      >
        <button
          type="button"
          onClick={exitPanelScope}
          aria-label="Back to all projects"
          title="All projects"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ChevronLeft aria-hidden className="size-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Switch project"
              className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <h2 className="truncate text-[1rem] font-semibold">{project}</h2>
              <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {snapshot.projects.map((p) => (
              <DropdownMenuItem
                key={p.name}
                onSelect={() => onOpenProject(p.name)}
                className="gap-2"
              >
                <FolderGit2 className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.name === project && <Check className="size-4 text-primary" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onAddProject} className="gap-2">
              <FolderGit2 className="size-4 text-muted-foreground" />
              Add project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav aria-label={`${project} sections`} className="flex shrink-0 flex-col gap-px px-2 pt-2">
        {PROJECT_SECTIONS.map(({ id, label, icon: Icon }) => {
          const active = onSection && surface === id;
          const count = status.counts[id];
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onOpenProject(project, id)}
              className={cn(
                row,
                active
                  ? "bg-accent/60 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              )}
            >
              <Icon aria-hidden className={cn("size-4 shrink-0", active && "text-primary")} />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {id === "runtime" && status.runtime && (
                <span
                  role="img"
                  aria-label={status.runtime === "failed" ? "A service failed" : "Services running"}
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    status.runtime === "failed" ? "bg-destructive" : "bg-ok",
                  )}
                />
              )}
              {count !== undefined && (
                <span className="shrink-0 font-mono text-[0.75rem] tabular-nums text-muted-foreground/70">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mt-4 flex shrink-0 items-center justify-between px-4 pb-1">
        <h3 className="text-[0.75rem] font-medium text-muted-foreground">Tasks</h3>
        <button
          type="button"
          aria-label={`New task in ${project}`}
          title={`New task in ${project}`}
          onClick={() => onNewTask(project)}
          className="grid size-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <TaskTree
        tree={tree}
        openTaskId={openTaskId}
        onOpenTask={onOpenTask}
        onOpenProject={onOpenProject}
        onAddProject={onAddProject}
        onSettleFinishedTurns={onSettleFinishedTurns}
      />
    </>
  );
}
