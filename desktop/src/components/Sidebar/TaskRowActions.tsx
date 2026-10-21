import {
  AlarmClockOff,
  Archive,
  Check,
  Clock,
  MoreHorizontal,
  Pin,
  Trash2,
  Undo2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ArchiveMergedTaskDialog } from "@/components/pullRequest/ArchiveMergedTaskDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { daemon } from "@/daemon";
import { useTaskPullRequest } from "@/hooks/useTaskPullRequest";
import { buildSnoozePresets } from "@/lib/snooze";
import { taskLabel } from "@/lib/taskLabel";
import { cn } from "@/lib/utils";
import type { TaskInfo } from "@/protocol";

import { FactoryMenuItems } from "./FactoryMenuItems";
import type { SidebarTaskState } from "./logic";

const ACTION_BUTTON =
  "grid size-[22px] shrink-0 place-items-center rounded text-muted-foreground/70 transition-[color,background-color,transform] duration-100 ease-[var(--ease-out)] active:scale-[0.97] hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * A sidebar row's hover actions and its More menu. A Factory task's menu
 * also offers what its queue or its last run allows.
 * @param props.task The row's task.
 * @param props.state What the row shows the task as.
 * @param props.pinned Whether it is pinned to Mission Control.
 * @param props.factory Whether it is a Factory task.
 * @param props.onPin Toggles the pin.
 */
export function RowActions({
  task,
  state,
  pinned,
  factory,
  onPin,
}: {
  task: TaskInfo;
  state: SidebarTaskState;
  pinned: boolean;
  factory: boolean;
  onPin: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const pr = useTaskPullRequest(task.id);
  const mergedWorktree = pr?.state === "merged" && task.worktree ? pr : null;
  const label = taskLabel(task);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reopening must recompute "1 hour from now"
  const presets = useMemo(() => buildSnoozePresets(Date.now()), [snoozeOpen]);

  const run = useCallback(
    async (method: string, params: Record<string, unknown>) => {
      if (busy) return;
      setBusy(true);
      try {
        await daemon.request(method, params);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  return (
    <div
      className={cn(
        "absolute inset-y-0 right-1 hidden items-center gap-px",
        "pointer-events-none group-hover/row:pointer-events-auto group-hover/row:flex",
        "group-focus-within/row:pointer-events-auto group-focus-within/row:flex",
      )}
    >
      {state === "snoozed" ? (
        <button
          type="button"
          disabled={busy}
          aria-label={`Wake now: ${label}`}
          title="Wake now"
          className={ACTION_BUTTON}
          onClick={() => void run("task.unsnooze", { task_id: task.id })}
        >
          <AlarmClockOff className="size-3.5" />
        </button>
      ) : state === "settled" ? (
        <button
          type="button"
          disabled={busy}
          aria-label={`Return to active: ${label}`}
          title="Return to active"
          className={ACTION_BUTTON}
          onClick={() => void run("task.unsettle", { task_id: task.id })}
        >
          <Undo2 className="size-3.5" />
        </button>
      ) : (
        <>
          <DropdownMenu modal={false} open={snoozeOpen} onOpenChange={setSnoozeOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={busy}
                aria-label={`Remind later: ${label}`}
                title="Remind later"
                className={ACTION_BUTTON}
              >
                <Clock className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent align="end" className="w-44">
                {presets.map((preset) => (
                  <DropdownMenuItem
                    key={preset.id}
                    data-snooze-preset={preset.id}
                    onSelect={() =>
                      void run("task.snooze", { task_id: task.id, until: preset.until })
                    }
                  >
                    <span className="flex-1">{preset.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
          {task.status !== "running" && (
            <button
              type="button"
              disabled={busy}
              aria-label={`Mark handled: ${label}`}
              title="Mark handled"
              className={ACTION_BUTTON}
              onClick={() => void run("task.settle", { task_id: task.id })}
            >
              <Check className="size-3.5" />
            </button>
          )}
        </>
      )}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Task actions: ${label}`}
            title="More"
            className={ACTION_BUTTON}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent align="end" className="w-52">
            {factory && <FactoryMenuItems task={task} />}
            <DropdownMenuItem onSelect={() => onPin(task.id)}>
              <Pin className="size-3.5 opacity-70" />
              {pinned ? "Unpin from Mission Control" : "Pin to Mission Control"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void daemon.archiveTask(task.id)}>
              <Archive className="size-3.5 opacity-70" />
              Archive task
            </DropdownMenuItem>
            {mergedWorktree && (
              <DropdownMenuItem onSelect={() => setConfirmingArchive(true)}>
                <Archive className="size-3.5 opacity-70" />
                Archive and remove worktree
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setConfirmingDelete(true)}
            >
              <Trash2 className="size-3.5 opacity-70" />
              Delete task
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenu>

      {mergedWorktree && (
        <ArchiveMergedTaskDialog
          task={task}
          pr={mergedWorktree}
          open={confirmingArchive}
          onOpenChange={setConfirmingArchive}
        />
      )}
      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this task?"
        description={<>“{label}” and its conversation will be gone. This cannot be undone.</>}
        confirmLabel="Delete task"
        busyLabel="Deleting…"
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={async () => {
          await daemon.deleteTask(task.id);
          setConfirmingDelete(false);
        }}
      />
    </div>
  );
}
