import { Folder } from "lucide-react";

import type { Space, Snapshot, TaskInfo } from "@/protocol";
import { spaceProjectNames, useUi } from "@/store/ui";

import { ProjectBadge } from "./ProjectBadge";
import { ScopeHeader, ScopeLabel, ScopeTasks } from "./ScopeChrome";
import type { useSidebarTree } from "./useSidebarTree";

interface Props {
  space: Space;
  snapshot: Snapshot;
  tree: ReturnType<typeof useSidebarTree>;
  openTask: TaskInfo | null;
  openTaskId: string | null;
  onOpenProject: (name: string) => void;
  onOpenTask: (id: string) => void;
  onNewTask: (project?: string) => void;
  onAddProject: () => void;
  onSettleFinishedTurns?: (ids: string[]) => void;
}

const row =
  "flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[0.8125rem] transition-colors";

/**
 * The Tasks panel narrowed to a space: its member projects (each opens that
 * project's mode), its loose folders, then the tasks of every member project.
 */
export function SpacePanel({
  space,
  snapshot,
  tree,
  openTask,
  openTaskId,
  onOpenProject,
  onOpenTask,
  onNewTask,
  onAddProject,
  onSettleFinishedTurns,
}: Props) {
  const selectedProject = useUi((s) => s.selectedProjectId);
  const projects = spaceProjectNames(space);
  // New Task asks for the primary project; start from the one you came from.
  const primary =
    [openTask?.project, selectedProject].find(
      (name): name is string => !!name && projects.includes(name),
    ) ?? projects[0];

  return (
    <>
      <ScopeHeader
        title={space.name}
        current={{ kind: "space", id: space.id }}
        snapshot={snapshot}
        onOpenProject={onOpenProject}
        onAddProject={onAddProject}
      />
      <ScopeLabel label="Projects" />
      <ul aria-label={`${space.name} members`} className="flex shrink-0 flex-col gap-px px-2">
        {space.members.map((member) =>
          member.kind === "project" ? (
            <li key={`project:${member.name}`}>
              <button
                type="button"
                onClick={() => onOpenProject(member.name)}
                className={`${row} text-foreground hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring`}
              >
                <ProjectBadge name={member.name} />
                <span className="min-w-0 flex-1 truncate">{member.name}</span>
              </button>
            </li>
          ) : (
            <li key={`folder:${member.path}`} className={row} title={member.path}>
              <Folder aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="shrink-0 text-muted-foreground">{member.name}</span>
              <span className="min-w-0 flex-1 truncate text-[0.75rem] text-muted-foreground/60">
                {member.path}
              </span>
            </li>
          ),
        )}
        {space.members.length === 0 && (
          <li className="px-2 py-1 text-[0.75rem] text-muted-foreground">
            No members yet. Add them in Settings → Spaces & repos.
          </li>
        )}
      </ul>
      <ScopeTasks
        onNewTaskIn={onNewTask}
        newTaskLabel={`New task in ${space.name}`}
        tree={tree}
        openTaskId={openTaskId}
        onNewTask={() => onNewTask(primary)}
        onOpenTask={onOpenTask}
        onOpenProject={onOpenProject}
        onAddProject={onAddProject}
        onSettleFinishedTurns={onSettleFinishedTurns}
      />
    </>
  );
}
