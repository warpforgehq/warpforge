import { cn } from "@/lib/utils";
import type { Snapshot } from "@/protocol";
import { type ProjectSurface, spaceOfProject, useUi, type View } from "@/store/ui";
import { useProjectSection, useVisibleSections } from "@/views/projects/sections";
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
 * The back chevron returns the panel to the project's space, or to every project.
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
  const surface = useProjectSection(project);
  const sections = useVisibleSections();
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
        back={space ? { label: space.name, onClick: () => openSpace(space.id) } : undefined}
      />

      <nav aria-label={`${project} sections`} className="flex shrink-0 flex-col gap-px px-2 pt-2">
        {sections.map(({ id, label, icon: Icon }) => {
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
        onNewTaskIn={onNewTask}
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
