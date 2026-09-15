import {
  AlarmClockOff,
  Archive,
  Check,
  ChevronRight,
  Clock,
  MoreHorizontal,
  Pin,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AgentLogo } from "@/components/AgentLogo";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { daemon } from "@/daemon";
import { buildSnoozePresets } from "@/lib/snooze";
import { elapsed } from "@/lib/status";
import { isOrchestratorTask } from "@/lib/taskGroups";
import { taskLabel } from "@/lib/taskLabel";
import { cn } from "@/lib/utils";
import type { TaskInfo } from "@/protocol";

import {
  LANE_GAP_PX,
  LANE_META_PX,
  LANE_TWISTY_PX,
  SIDEBAR_INDENT_PX,
  SIDEBAR_MAX_INDENT_LEVELS,
  SIDEBAR_STATE_META,
  snoozeWakeLabel,
  type SidebarTaskState,
} from "./Sidebar/logic";
import { RowGutter } from "./Sidebar/RowGutter";
import { SidebarTaskTooltipBody } from "./Sidebar/SidebarTaskTooltip";
import { STATE_ICON } from "./Sidebar/stateIcons";

/**
 * One task row. Anatomy, left to right:
 *
 *   [gutter][twisty] [status glyph] title …         [agent] [elapsed]
 *                                                   └ swapped for row actions
 *                                                     on hover / focus
 *
 * Every lane is fixed and shared (spec 08 §C.1): the gutter is `depth × 12px`
 * with the tree rail absolutely positioned inside it, then a 16px twisty lane,
 * a 16px glyph lane, the flexing title, and a 72px meta lane. Indent is the
 * button's `padding-left`, so the row fills the list width and hover/active
 * never stair-step; it is not `margin-left`.
 *
 * The glyph lane is reserved on every row and only four states draw into it
 * (`SIDEBAR_STATE_META.rowGlyph`), so a silent row's title starts at the same x
 * as a working sibling's — hierarchy is the rail's job, not a width shift.
 */

/** Self-ticking so a running row's timer costs one span, not a list re-render. */
function LiveElapsed({ since }: { since: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((tick) => tick + 1), 1_000);
    return () => window.clearInterval(id);
  }, []);
  return <>{elapsed(since)}</>;
}

const ACTION_BUTTON =
  "grid size-[22px] shrink-0 place-items-center rounded text-muted-foreground/70 transition-[color,background-color,transform] duration-100 ease-[var(--ease-out)] active:scale-[0.97] hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function RowActions({
  task,
  state,
  pinned,
  onPin,
}: {
  task: TaskInfo;
  state: SidebarTaskState;
  pinned: boolean;
  onPin: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
        "absolute inset-y-0 right-1 flex items-center gap-px opacity-0 transition-opacity",
        "pointer-events-none group-hover/row:pointer-events-auto group-hover/row:opacity-100",
        "group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100",
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
            <DropdownMenuItem onSelect={() => onPin(task.id)}>
              <Pin className="size-3.5 opacity-70" />
              {pinned ? "Unpin from Mission Control" : "Pin to Mission Control"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void daemon.archiveTask(task.id)}>
              <Archive className="size-3.5 opacity-70" />
              Archive task
            </DropdownMenuItem>
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

export interface SidebarTaskRowProps {
  task: TaskInfo;
  state: SidebarTaskState;
  depth: number;
  ancestorLines: readonly boolean[];
  isLast: boolean;
  onActivePath: boolean;
  active: boolean;
  childCount: number;
  expanded: boolean;
  pinned: boolean;
  nowSec: number;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onPin: (id: string) => void;
}

export const SidebarTaskRow = memo(function SidebarTaskRow({
  task,
  state,
  depth,
  ancestorLines,
  isLast,
  onActivePath,
  active,
  childCount,
  expanded,
  pinned,
  nowSec,
  onOpen,
  onToggle,
  onPin,
}: SidebarTaskRowProps) {
  const label = taskLabel(task);
  const meta = SIDEBAR_STATE_META[state];
  const StateIcon = STATE_ICON[meta.icon];
  const receded = state === "snoozed" || state === "settled" || state === "done";
  const orchestrator = isOrchestratorTask(task, childCount);
  const gutterWidth = Math.min(depth, SIDEBAR_MAX_INDENT_LEVELS) * SIDEBAR_INDENT_PX;

  return (
    <div className="group/row relative" data-rail-depth={depth}>
      <RowGutter
        depth={depth}
        ancestorLines={ancestorLines}
        isLast={isLast}
        onActivePath={onActivePath}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-task-id={task.id}
            data-task-state={state}
            onClick={() => onOpen(task.id)}
            aria-label={`Open task: ${label}`}
            style={{ paddingLeft: gutterWidth + LANE_TWISTY_PX + LANE_GAP_PX }}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-md pr-2 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              active ? "font-medium text-foreground" : "hover:bg-accent/60",
            )}
          >
            <span data-lane="glyph" className="grid w-4 shrink-0 place-items-center">
              {meta.rowGlyph && (
                <StateIcon
                  aria-hidden
                  data-task-glyph={state}
                  className={cn(
                    "size-3.5",
                    meta.toneClass,
                    meta.live && "animate-[spin_3s_linear_infinite] motion-reduce:animate-none",
                  )}
                />
              )}
            </span>
            <span
              data-lane="title"
              className={cn(
                "min-w-0 flex-1 truncate text-[13px] leading-none",
                active ? "font-medium text-foreground" : meta.titleClass,
              )}
            >
              {label}
            </span>
            {orchestrator && (
              <span title="Orchestrator lead" className="inline-flex shrink-0">
                <Users aria-hidden className="size-3 text-muted-foreground/60" />
              </span>
            )}
            <span
              data-lane="meta"
              style={{ width: LANE_META_PX }}
              className="relative ml-auto flex h-6 shrink-0 items-center justify-end gap-1 transition-opacity group-hover/row:opacity-0 group-focus-within/row:opacity-0"
            >
              {childCount > 0 && (
                <span className="tnum w-4 text-right text-[10px] text-muted-foreground/45">
                  {childCount}
                </span>
              )}
              <AgentLogo
                agentId={task.agent}
                displayName={task.agent}
                className={cn("size-3.5 shrink-0", receded && "opacity-40 grayscale")}
              />
              {state === "snoozed" ? (
                <span className="tnum w-8 text-right text-[11px] text-info/80">
                  {snoozeWakeLabel(task.snoozedUntil!, nowSec)}
                </span>
              ) : (
                <span className="tnum w-8 text-right text-[11px] text-muted-foreground/50">
                  {meta.live ? <LiveElapsed since={task.updatedAt} /> : elapsed(task.updatedAt)}
                </span>
              )}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" align="start" sideOffset={10} className="p-2">
          <SidebarTaskTooltipBody
            task={task}
            state={state}
            childCount={childCount}
            nowSec={nowSec}
          />
        </TooltipContent>
      </Tooltip>

      {childCount > 0 && (
        <button
          type="button"
          data-expand={task.id}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${childCount} subtask${childCount === 1 ? "" : "s"} of ${label}`}
          onClick={() => onToggle(task.id)}
          style={{ left: gutterWidth }}
          className="absolute top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ChevronRight
            aria-hidden
            className={cn("size-3 transition-transform", expanded && "rotate-90")}
          />
        </button>
      )}

      <RowActions task={task} state={state} pinned={pinned} onPin={onPin} />
    </div>
  );
});
