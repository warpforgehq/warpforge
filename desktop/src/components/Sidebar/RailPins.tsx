import { Hash } from "lucide-react";
import { useEffect, useMemo, type DragEvent, type MouseEvent } from "react";

import { SmithAvatar } from "@/components/SmithAvatar";
import { TaskAgentMark } from "@/components/TaskSmith";
import type { DaemonState } from "@/daemon";
import { useContextMenu } from "@/hooks/useContextMenu";
import { defaultSmithColor, smithColor } from "@/lib/smithColors";
import { taskLabel } from "@/lib/taskLabel";
import { cn } from "@/lib/utils";
import type { TaskInfo } from "@/protocol";
import { pinKey, usePins, type Pin } from "@/store/pins";
import { useSmithsStore } from "@/store/smiths";
import { scopeProjects, useUi } from "@/store/ui";

import { SIDEBAR_STATE_META } from "./logic/stateMeta";
import { resolveTaskState } from "./logic/taskState";
import { RailButton } from "./RailButton";

const PIN_DRAG_MIME = "application/x-warpforge-pin";

/**
 * A right-click menu that pins `pin` to the rail, or unpins it.
 * @returns a handler to put on the row's `onContextMenu`
 */
export function usePinContextMenu() {
  const openContextMenu = useContextMenu();
  return (event: MouseEvent, pin: Pin) => {
    event.preventDefault();
    const pinned = usePins.getState().has(pin);
    openContextMenu({
      at: { x: event.clientX, y: event.clientY },
      items: [{ type: "item", id: "pin", label: pinned ? "Unpin from rail" : "Pin to rail" }],
      handlers: new Map([["pin", () => usePins.getState().toggle(pin)]]),
    });
  };
}

function ProjectTile({ name }: { name: string }) {
  const index = defaultSmithColor(name);
  return (
    <span
      aria-hidden
      style={{ backgroundColor: smithColor(index, 0.18), color: smithColor(index) }}
      className="grid size-6 place-items-center rounded-md text-[0.75rem] font-bold uppercase leading-none"
    >
      {name.slice(0, 1)}
    </span>
  );
}

/** Whether the main area is showing what `pin` points at. */
function usePinActive(pin: Pin): boolean {
  return useUi((s) => {
    if (s.settingsOpen) return false;
    if (pin.kind === "task") return s.openTaskId === pin.id;
    if (pin.kind === "project") {
      return s.sidebarMode === "tasks" && (scopeProjects(s.panelScope)?.includes(pin.id) ?? false);
    }
    if (s.openTaskId) return false;
    const selection = s.view === "team" ? s.teamSelection : null;
    if (!selection) return false;
    return pin.kind === "smith"
      ? selection.kind === "teammate" && selection.id === pin.id
      : selection.kind === "conversation" && selection.key === pin.id;
  });
}

function PinButton({
  pin,
  index,
  roving,
  task,
  attention,
  nowSec,
  onOpenTask,
}: {
  pin: Pin;
  index: number;
  task: TaskInfo | undefined;
  attention: boolean;
  nowSec: number;
  onOpenTask: (id: string) => void;
  roving: (key: string) => { onFocus: () => void; tabIndex: number };
}) {
  const smith = useSmithsStore((s) => (pin.kind === "smith" ? s.smiths[pin.id] : undefined));
  const active = usePinActive(pin);
  const openContextMenu = useContextMenu();
  const key = pinKey(pin);

  const status = task
    ? SIDEBAR_STATE_META[resolveTaskState(task, { attention, nowSec })]
    : undefined;
  const label =
    pin.kind === "project"
      ? pin.id
      : pin.kind === "smith"
        ? (smith?.name ?? "Smith")
        : pin.kind === "channel"
          ? `#${pin.name}`
          : task
            ? taskLabel(task)
            : pin.id;

  const open = () => {
    const ui = useUi.getState();
    if (pin.kind === "task") {
      ui.setSidebarMode("tasks");
      onOpenTask(pin.id);
    } else if (pin.kind === "project") {
      ui.openProject(pin.id);
    } else {
      ui.setSidebarMode("team");
      ui.openTeam(
        pin.kind === "smith"
          ? { id: pin.id, kind: "teammate" }
          : { key: pin.id, kind: "conversation" },
      );
    }
  };

  return (
    <RailButton
      label={label}
      tooltip={
        status ? `${label} · ${task?.project || "Chat"} · ${status.label}` : `${label} · pinned`
      }
      onClick={open}
      draggable
      onDragStart={(event: DragEvent) => {
        event.dataTransfer.setData(PIN_DRAG_MIME, key);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(event: DragEvent) => {
        if (event.dataTransfer.types.includes(PIN_DRAG_MIME)) event.preventDefault();
      }}
      onDrop={(event: DragEvent) => {
        const dragged = event.dataTransfer.getData(PIN_DRAG_MIME);
        if (dragged && dragged !== key) usePins.getState().move(dragged, index);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        openContextMenu({
          at: { x: event.clientX, y: event.clientY },
          items: [{ type: "item", id: "unpin", label: "Unpin from rail" }],
          handlers: new Map([["unpin", () => usePins.getState().toggle(pin)]]),
        });
      }}
      className={cn("shrink-0", active && "bg-accent/60")}
      {...roving(`pin:${key}`)}
    >
      <span
        data-pin={key}
        className={cn(
          "relative grid place-items-center rounded-md",
          active && "ring-[1.5px] ring-primary ring-offset-2 ring-offset-chrome",
          pin.kind === "smith" && "rounded-full",
        )}
      >
        {pin.kind === "project" ? (
          <ProjectTile name={pin.id} />
        ) : pin.kind === "smith" ? (
          <SmithAvatar smith={{ id: pin.id, name: smith?.name ?? "?" }} />
        ) : task && status ? (
          <>
            <TaskAgentMark task={task} className="size-6 p-0.5" />
            <span
              role="img"
              aria-label={status.label}
              data-status-light
              className={cn(
                "absolute -bottom-px -right-px size-1.5 rounded-full bg-current ring-2 ring-chrome",
                status.toneClass,
                status.live && "motion-safe:animate-pulse",
              )}
            />
          </>
        ) : (
          <span className="grid size-6 place-items-center rounded-md bg-muted-foreground/15 text-muted-foreground">
            <Hash aria-hidden className="size-3.5" strokeWidth={2.25} />
          </span>
        )}
      </span>
    </RailButton>
  );
}

/**
 * Tasks, projects, Smiths and channels kept on the rail. Drag to reorder or
 * right-click a pin to unpin it.
 */
export function RailPins({
  roving,
  state,
  attentionIds,
  nowSec,
  onOpenTask,
}: {
  state: DaemonState;
  attentionIds: ReadonlySet<string>;
  nowSec: number;
  onOpenTask: (id: string) => void;
  roving: (key: string) => { onFocus: () => void; tabIndex: number };
}) {
  const pins = usePins((s) => s.pins);
  const prune = usePins((s) => s.prune);
  const { snapshot, connection, snapshotReady } = state;
  const tasks = useMemo(
    () => new Map(snapshot.tasks.map((task) => [task.id, task])),
    [snapshot.tasks],
  );
  const smiths = useSmithsStore((s) => s.smiths);

  useEffect(() => {
    if (connection !== "connected" || !snapshotReady) return;
    const projects = new Set(snapshot.projects.map((project) => project.name));
    prune((pin) =>
      pin.kind === "project"
        ? projects.has(pin.id)
        : pin.kind === "smith"
          ? Object.keys(smiths).length === 0 || pin.id in smiths
          : pin.kind === "task"
            ? tasks.has(pin.id)
            : true,
    );
  }, [connection, snapshotReady, snapshot.projects, smiths, tasks, pins, prune]);

  if (pins.length === 0) return null;
  return (
    <>
      {pins.map((pin, index) => {
        const task = pin.kind === "task" ? tasks.get(pin.id) : undefined;
        if (pin.kind === "task" && !task) return null;
        return (
          <PinButton
            key={pinKey(pin)}
            pin={pin}
            index={index}
            task={task}
            attention={!!task && attentionIds.has(task.id)}
            nowSec={nowSec}
            onOpenTask={onOpenTask}
            roving={roving}
          />
        );
      })}
    </>
  );
}
