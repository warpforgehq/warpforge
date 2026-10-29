import { ArrowRightFromLine } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { ContinueSessionDialog } from "@/components/ContinueSessionDialog";
import { ProjectBadge } from "@/components/Sidebar/ProjectBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { daemon } from "@/daemon";
import { useTaskSessionUpdates } from "@/hooks/useTaskSessionUpdates";
import type { TaskInfo } from "@/protocol";
import { useUi } from "@/store/ui";

/**
 * Moves a chat's conversation into a new task in a project, through the
 * continue dialog. The chat itself stays as it is and can still be used.
 * @param props.task The chat.
 * @returns The project menu, and the dialog once a project is picked.
 */
export function ContinueInProject({ task }: { task: TaskInfo }) {
  const projects = useSyncExternalStore(daemon.subscribe, daemon.getState).snapshot.projects;
  const updates = useTaskSessionUpdates(task.id);
  const openTask = useUi((s) => s.openTask);
  const [project, setProject] = useState<string | null>(null);
  if (projects.length === 0) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={updates.length === 0}
            className="flex h-5 items-center gap-1 rounded px-1.5 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            <ArrowRightFromLine aria-hidden className="size-3" />
            Continue in project…
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
          <DropdownMenuLabel className="text-[11px]">Continue in</DropdownMenuLabel>
          {projects.map((candidate) => (
            <DropdownMenuItem
              key={candidate.name}
              className="text-[13px]"
              onSelect={() => setProject(candidate.name)}
            >
              <ProjectBadge name={candidate.name} />
              <span className="truncate">{candidate.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {project && (
        <ContinueSessionDialog
          open
          onOpenChange={(next) => {
            if (!next) setProject(null);
          }}
          task={task}
          updates={updates}
          throughIndex={updates.length - 1}
          targetAgent={task.agent}
          targetProject={project}
          onOpenTask={openTask}
        />
      )}
    </>
  );
}
