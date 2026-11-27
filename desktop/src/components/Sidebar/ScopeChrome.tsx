import { Pin, PinOff, Plus } from "lucide-react";

import type { Snapshot } from "@/protocol";
import { pinKey, usePins } from "@/store/pins";
import type { TaskListView } from "@/store/ui";

import { PanelSwitcher } from "./PanelSwitcher";
import { usePinContextMenu } from "./RailPins";
import { TaskTree } from "./TaskTree";
import type { useSidebarTree } from "./useSidebarTree";

/**
 * The scoped panel's title row: the panel switcher on the scope's name, and
 * for a space a pin toggle.
 */
export function ScopeHeader({
  title,
  current,
  snapshot,
  attention,
  onOpenProject,
  onAddProject,
}: {
  title: string;
  /** The scope shown, so the switcher can tick it. */
  current: { kind: "project" | "space"; id: string };
  snapshot: Snapshot;
  attention: Record<TaskListView, number>;
  onOpenProject: (name: string) => void;
  onAddProject: () => void;
}) {
  const pinMenu = usePinContextMenu();
  const pin = { id: current.id, kind: current.kind } as const;
  const pinned = usePins((s) => s.pins.some((candidate) => pinKey(candidate) === pinKey(pin)));
  const togglePin = usePins((s) => s.toggle);

  return (
    <div
      data-tauri-drag-region="deep"
      className="group/scope flex h-10 shrink-0 items-center gap-0.5 pl-6 pr-3 pt-2"
    >
      <PanelSwitcher
        title={title}
        current={current}
        snapshot={snapshot}
        attention={attention}
        onOpenProject={onOpenProject}
        onAddProject={onAddProject}
        onContextMenu={(event) => pinMenu(event, pin)}
      />
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
