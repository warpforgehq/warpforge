import { Layers } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Snapshot } from "@/protocol";
import {
  DEFAULT_PROJECT_SURFACE,
  type ProjectSurface,
  spaceOfProject,
  useUi,
  type View,
} from "@/store/ui";
import { PROJECT_SECTIONS } from "@/views/projects/sections";
import { useProjectSectionStatus } from "@/views/projects/useProjectSectionStatus";

import { ScopeHeader, ScopeTasks } from "./ScopeChrome";
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
  "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[0.8125rem] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

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
  const openSpace = useUi((s) => s.openSpace);
  const space = spaceOfProject(project, snapshot.spaces ?? []);
  const surface = useUi((s) => s.projectSurfaceByProject[project] ?? DEFAULT_PROJECT_SURFACE);
  const status = useProjectSectionStatus(project, snapshot);
  const onSection = view === "project" && !openTaskId;

  return (
    <>
      <ScopeHeader
        title={project}
        current={{ kind: "project", id: project }}
        snapshot={snapshot}
        onOpenProject={onOpenProject}
        onAddProject={onAddProject}
      />
      {space && (
        <button
          type="button"
          onClick={() => openSpace(space.id)}
          title={`Back to ${space.name}`}
          className="mx-4 -mt-0.5 flex w-fit max-w-[calc(100%-2rem)] items-center gap-1 rounded px-1 text-[0.75rem] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Layers aria-hidden className="size-3 shrink-0" />
          <span className="truncate">in {space.name}</span>
        </button>
      )}

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
              <Icon aria-hidden className={cn("size-3.5 shrink-0", active && "text-primary")} />
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

      <ScopeTasks
        newTaskLabel={`New task in ${project}`}
        tree={tree}
        openTaskId={openTaskId}
        onNewTask={() => onNewTask(project)}
        onOpenTask={onOpenTask}
        onOpenProject={onOpenProject}
        onAddProject={onAddProject}
        onSettleFinishedTurns={onSettleFinishedTurns}
      />
    </>
  );
}
