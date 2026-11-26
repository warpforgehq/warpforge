import { X } from "lucide-react";
import { useState, type DragEvent, type MouseEvent } from "react";
import { toast } from "sonner";

import { SIDEBAR_STATE_META, type SidebarTaskState } from "@/components/Sidebar/logic";
import { TaskAgentMark } from "@/components/TaskSmith";
import { daemon } from "@/daemon";
import { taskLabel } from "@/lib/taskLabel";
import { MAX_TITLE_LENGTH } from "@/lib/taskTitle";
import { cn } from "@/lib/utils";
import type { TaskInfo } from "@/protocol";

export const TAB_DRAG_MIME = "application/x-warpforge-tab";

/**
 * One open task in the title bar: agent mark, title, status light, close.
 * @param task the task the tab shows
 * @param state its sidebar state, for the light
 * @param active whether it is the task on screen
 * @param onSelect show the task
 * @param onClose close the tab; the task stays on the board
 * @param onDropTab another tab was dropped onto this one
 */
export function TaskTab({
  task,
  state,
  active,
  onSelect,
  onClose,
  onDropTab,
}: {
  task: TaskInfo;
  state: SidebarTaskState;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onDropTab: (draggedId: string) => void;
}) {
  const label = taskLabel(task);
  const meta = SIDEBAR_STATE_META[state];
  const quiet = state === "idle" || state === "settled" || state === "snoozed";
  const [editing, setEditing] = useState(false);

  const rename = async (title: string) => {
    try {
      await daemon.setTaskTitle(task.id, title);
    } catch (error) {
      toast.error("Could not rename the task", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const onAuxClick = (event: MouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
    onClose();
  };

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={`${label}\n${task.project || "Chat"} · ${meta.label}\nDouble-click to rename`}
      data-task-tab={task.id}
      draggable={!editing}
      onDragStart={(event: DragEvent) => {
        event.dataTransfer.setData(TAB_DRAG_MIME, task.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(event: DragEvent) => {
        if (event.dataTransfer.types.includes(TAB_DRAG_MIME)) event.preventDefault();
      }}
      onDrop={(event: DragEvent) => {
        const dragged = event.dataTransfer.getData(TAB_DRAG_MIME);
        if (dragged && dragged !== task.id) onDropTab(dragged);
      }}
      onClick={() => {
        if (!active) onSelect();
      }}
      onDoubleClick={() => setEditing(true)}
      onAuxClick={onAuxClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group relative flex h-7 min-w-24 max-w-52 flex-1 basis-52 cursor-default select-none items-center gap-1.5 rounded-md border pl-2.5 pr-1.5 text-[0.75rem] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        active
          ? "border-border/60 bg-background text-foreground shadow-[0_1px_2px_hsl(var(--foreground)/0.08)]"
          : "border-transparent text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
      )}
    >
      <TaskAgentMark task={task} className="size-3.5 shrink-0" />
      {editing ? (
        <input
          ref={(input) => input?.select()}
          aria-label="Task title"
          defaultValue={label}
          maxLength={MAX_TITLE_LENGTH}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") event.currentTarget.blur();
            else if (event.key === "Escape") {
              event.currentTarget.value = label;
              event.currentTarget.blur();
            }
          }}
          onBlur={(event) => {
            setEditing(false);
            const next = event.currentTarget.value.trim();
            if (next && next !== label) void rename(next);
          }}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[0.75rem] text-foreground outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
      {!quiet && (
        <span
          aria-hidden
          data-status-light={state}
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            !active && "group-hover:hidden",
            meta.toneClass.replace(/^text-/, "bg-"),
            meta.live && "motion-safe:animate-pulse",
          )}
        />
      )}
      <button
        type="button"
        aria-label={`Close tab ${label}`}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className={cn(
          "size-4 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground",
          active ? "grid" : "hidden group-hover:grid",
        )}
      >
        <X aria-hidden className="size-3" />
      </button>
    </div>
  );
}
