import { TaskAgentMark } from "@/components/TaskSmith";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { taskLabel } from "@/lib/taskLabel";
import { cn } from "@/lib/utils";
import type { TaskInfo } from "@/protocol";

import { SIDEBAR_STATE_META, type SidebarTaskState } from "./logic";
import { RailButton } from "./RailButton";

export interface LiveLaneItem {
  task: TaskInfo;
  state: SidebarTaskState;
  attention: boolean;
}

/**
 * Work in flight or waiting on a human, one chip per task: the agent's glyph
 * with a status light. Live turns glow in the theme's primary.
 */
export function LiveLane({
  lane,
  openTaskId,
  onOpenTask,
  onOverflow,
  roving,
}: {
  lane: { tasks: LiveLaneItem[]; overflow: number };
  openTaskId: string | null;
  onOpenTask: (id: string) => void;
  onOverflow: () => void;
  roving: (key: string) => { onFocus: () => void; tabIndex: number };
}) {
  if (lane.tasks.length === 0) return null;
  return (
    <div role="group" aria-label="Live tasks" className="flex flex-col items-center gap-1">
      <span
        aria-hidden
        className="select-none font-mono text-[0.5625rem] uppercase tracking-[0.18em] text-muted-foreground/60"
      >
        Live
      </span>
      {lane.tasks.map((item) => (
        <LiveChip
          key={item.task.id}
          item={item}
          open={openTaskId === item.task.id}
          onClick={() => onOpenTask(item.task.id)}
          {...roving(`live:${item.task.id}`)}
        />
      ))}
      {lane.overflow > 0 && (
        <RailButton
          label={`${lane.overflow} more live tasks`}
          onClick={onOverflow}
          {...roving("live:overflow")}
        >
          <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
            +{lane.overflow}
          </span>
        </RailButton>
      )}
    </div>
  );
}

function LiveChip({
  item,
  open,
  onClick,
  onFocus,
  tabIndex,
}: {
  item: LiveLaneItem;
  open: boolean;
  onClick: () => void;
  onFocus: () => void;
  tabIndex: number;
}) {
  const label = taskLabel(item.task);
  const meta = SIDEBAR_STATE_META[item.state];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-rail-item
          data-live-task={item.task.id}
          data-task-state={item.state}
          data-open={open || undefined}
          tabIndex={tabIndex}
          onFocus={onFocus}
          onClick={onClick}
          aria-label={`${label} — ${meta.label}`}
          className={cn(
            "relative grid size-8 place-items-center rounded-md border transition-[color,background-color,border-color,transform] duration-100 ease-[var(--ease-out)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
            meta.live
              ? "border-primary/30 bg-primary/10 shadow-[0_0_12px_-3px_hsl(var(--primary)/0.55)]"
              : "border-transparent hover:bg-accent/40",
            open && "border-ring/60",
          )}
        >
          <TaskAgentMark task={item.task} className="size-4" />
          <span
            aria-hidden
            data-status-light
            className={cn(
              "absolute -bottom-px -right-px size-[7px] rounded-full ring-2 ring-chrome",
              meta.toneClass.replace(/^text-/, "bg-"),
              meta.live && "animate-pulse",
            )}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="flex max-w-64 flex-col gap-0.5">
        <span className="truncate font-medium">{label}</span>
        <span className="flex items-center gap-1.5 font-mono text-[0.625rem] text-muted-foreground">
          <span>{item.task.project}</span>
          <span aria-hidden>·</span>
          <span className={meta.toneClass}>{meta.label}</span>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
