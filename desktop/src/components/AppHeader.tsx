import { Check, ChevronDown, Folder, FolderGit2 } from "lucide-react";
import { useRef } from "react";

import { TaskPullRequestChip } from "@/components/pullRequest/TaskPullRequestChip";
import { TaskSmithByline } from "@/components/TaskSmith";
import { TaskTabs } from "@/components/titlebar/TaskTabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Snapshot, TaskInfo } from "@/protocol";
import { useTitleRow } from "@/store/titleRow";
import { useUi, type View } from "@/store/ui";

interface AppHeaderProps {
  view: View;
  openTask: TaskInfo | null;
  snapshot: Snapshot;
  /** The macOS window buttons sit over this row's left end. */
  windowButtonsInset: boolean;
  /** The new-task composer covers the main area; task controls hide. */
  composing: boolean;
  onAddProject: () => void;
  onOpenTask: (id: string) => void;
  onCloseTask: () => void;
}

/** Room the macOS window buttons take at the left of the row. */
const WINDOW_BUTTONS_WIDTH = 84;

/**
 * The window's title row above the main card: one tab per open task, and the
 * open task's controls at the right end — workspace, pull request, menu. The
 * whole row drags the window; Tauri's handler skips buttons and roles.
 * @param props see `AppHeaderProps`
 * @returns the row
 */
export default function AppHeader({
  view,
  openTask,
  snapshot,
  windowButtonsInset,
  composing,
  onAddProject,
  onOpenTask,
  onCloseTask,
}: AppHeaderProps) {
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const openProject = useUi((s) => s.openProject);
  const isProject = view === "project" && !openTask && !composing;
  const crumbProject =
    isProject && snapshot.projects.length > 0
      ? (snapshot.projects.find((p) => p.name === selectedProjectId) ?? snapshot.projects[0])
      : null;
  const task = composing ? null : openTask;
  const setSlot = useTitleRow((state) => state.setSlot);
  const setSurfaceSlot = useTitleRow((state) => state.setSurfaceSlot);
  const setMetaSlot = useTitleRow((state) => state.setMetaSlot);
  const setPaneSlot = useTitleRow((state) => state.setPaneSlot);
  const paneFull = useTitleRow((state) => state.paneFull);
  const splitX = useTitleRow((state) => state.splitX);
  const headerRef = useRef<HTMLElement>(null);
  const headerRight = headerRef.current?.getBoundingClientRect().right ?? null;
  const rightWidth =
    task && splitX !== null && headerRight !== null ? Math.max(0, headerRight - splitX) : null;

  return (
    <header
      ref={headerRef}
      data-tauri-drag-region="deep"
      className="flex h-10 shrink-0 items-center gap-2"
      style={{ paddingLeft: windowButtonsInset ? WINDOW_BUTTONS_WIDTH : 8 }}
    >
      {crumbProject && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Switch project"
              className="flex min-w-0 max-w-56 shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{crumbProject.name}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {snapshot.projects.map((p) => (
              <DropdownMenuItem key={p.name} onSelect={() => openProject(p.name)} className="gap-2">
                <FolderGit2 className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.name === crumbProject.name && <Check className="size-4 text-primary" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onAddProject} className="gap-2">
              <FolderGit2 className="size-4 text-muted-foreground" />
              Add project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {task && !paneFull && (
        <TaskTabs
          snapshot={snapshot}
          openTaskId={task ? task.id : null}
          onOpenTask={onOpenTask}
          onCloseActive={(next) => (next ? onOpenTask(next) : onCloseTask())}
        />
      )}

      <div ref={setSlot} className="flex shrink-0 items-center empty:hidden" />

      {task && (
        <div
          className={cn(
            "flex shrink-0 items-center justify-end gap-1.5 self-stretch pr-2",
            paneFull && "min-w-0 flex-1",
            rightWidth !== null && "pl-2",
          )}
          style={rightWidth !== null ? { width: rightWidth } : undefined}
        >
          <div ref={setSurfaceSlot} className="flex min-w-0 flex-1 items-center self-stretch" />
          <div ref={setMetaSlot} className="flex shrink-0 items-center gap-2 empty:hidden" />
          <TaskSmithByline task={task} interactive />
          {task.worktree && (
            <span
              className="flex size-6 items-center justify-center rounded text-muted-foreground"
              title={`Git worktree: ${task.worktree}`}
              aria-label="Runs in a git worktree"
            >
              <Folder className="size-3.5" />
            </span>
          )}
          <TaskPullRequestChip task={task} />
          <div ref={setPaneSlot} className="flex shrink-0 items-center gap-1 empty:hidden" />
        </div>
      )}
    </header>
  );
}
