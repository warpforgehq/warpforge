import {
  Check,
  ChevronDown,
  ChevronLeft,
  FolderGit2,
  Layers,
  Pin,
  PinOff,
  Plus,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Snapshot } from "@/protocol";
import { pinKey, usePins } from "@/store/pins";
import { useUi } from "@/store/ui";

import { usePinContextMenu } from "./RailPins";
import { TaskTree } from "./TaskTree";
import type { useSidebarTree } from "./useSidebarTree";

/**
 * The scoped panel's title row: back to every project, then the scope's name
 * as a switcher over spaces and projects.
 */
export function ScopeHeader({
  title,
  current,
  snapshot,
  onOpenProject,
  onAddProject,
}: {
  title: string;
  /** The scope shown, so the switcher can tick it. */
  current: { kind: "project" | "space"; id: string };
  snapshot: Snapshot;
  onOpenProject: (name: string) => void;
  onAddProject: () => void;
}) {
  const exitPanelScope = useUi((s) => s.exitPanelScope);
  const openSpace = useUi((s) => s.openSpace);
  const pinMenu = usePinContextMenu();
  const pin = { id: current.id, kind: current.kind } as const;
  const pinned = usePins((s) => s.pins.some((candidate) => pinKey(candidate) === pinKey(pin)));
  const togglePin = usePins((s) => s.toggle);
  const spaces = snapshot.spaces ?? [];
  const tick = (kind: "project" | "space", id: string) =>
    current.kind === kind && current.id === id && <Check className="size-4 text-primary" />;

  return (
    <div
      data-tauri-drag-region="deep"
      className="group/scope flex h-10 shrink-0 items-center gap-0.5 pl-9 pr-3 pt-2"
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
            aria-label={current.kind === "space" ? "Switch space" : "Switch project"}
            onContextMenu={(event) => pinMenu(event, pin)}
            className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <h2 className="truncate text-[1rem] font-semibold">{title}</h2>
            <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          {spaces.length > 0 && (
            <>
              <DropdownMenuLabel className="text-[0.75rem] font-normal text-muted-foreground">
                Spaces
              </DropdownMenuLabel>
              {spaces.map((space) => (
                <DropdownMenuItem
                  key={space.id}
                  onSelect={() => openSpace(space.id)}
                  className="gap-2"
                >
                  <Layers className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{space.name}</span>
                  {tick("space", space.id)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[0.75rem] font-normal text-muted-foreground">
                Projects
              </DropdownMenuLabel>
            </>
          )}
          {snapshot.projects.map((p) => (
            <DropdownMenuItem key={p.name} onSelect={() => onOpenProject(p.name)} className="gap-2">
              <FolderGit2 className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {tick("project", p.name)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onAddProject} className="gap-2">
            <FolderGit2 className="size-4 text-muted-foreground" />
            Add project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {current.kind === "space" && (
        <button
          type="button"
          aria-label={pinned ? "Unpin from rail" : "Pin to rail"}
          title={pinned ? "Unpin from rail" : "Pin to rail"}
          aria-pressed={pinned}
          onClick={() => togglePin(pin)}
          className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,color,background-color] hover:bg-accent/60 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/scope:opacity-100 group-focus-within/scope:opacity-100"
        >
          {pinned ? (
            <PinOff aria-hidden className="size-3.5" />
          ) : (
            <Pin aria-hidden className="size-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

/** A sentence-case label inside a scoped panel, with an optional + action. */
export function ScopeLabel({
  label,
  action,
}: {
  label: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="mt-4 flex shrink-0 items-center justify-between px-4 pb-1">
      <h3 className="text-[0.75rem] font-medium text-muted-foreground">{label}</h3>
      {action && (
        <button
          type="button"
          aria-label={action.label}
          title={action.label}
          onClick={action.onClick}
          className="grid size-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Plus className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** "Tasks" with its + and the scope's task tree. */
export function ScopeTasks({
  newTaskLabel,
  onNewTaskIn,
  tree,
  openTaskId,
  onNewTask,
  onOpenTask,
  onOpenProject,
  onAddProject,
  onSettleFinishedTurns,
}: {
  newTaskLabel: string;
  /** Starts a task in a project, from a project row's context menu. */
  onNewTaskIn: (project: string) => void;
  tree: ReturnType<typeof useSidebarTree>;
  openTaskId: string | null;
  onNewTask: () => void;
  onOpenTask: (id: string) => void;
  onOpenProject: (name: string) => void;
  onAddProject: () => void;
  onSettleFinishedTurns?: (ids: string[]) => void;
}) {
  return (
    <>
      <ScopeLabel label="Tasks" action={{ label: newTaskLabel, onClick: onNewTask }} />
      <TaskTree
        onNewTaskIn={onNewTaskIn}
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
