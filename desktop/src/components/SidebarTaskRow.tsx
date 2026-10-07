import { ChevronRight, Users, Workflow } from "lucide-react";
import { memo, useEffect, useState } from "react";

import { AgentLogo } from "@/components/AgentLogo";
import { TaskPullRequestGlyph } from "@/components/pullRequest/TaskPullRequestGlyph";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isFactoryTask } from "@/lib/factory";
import { elapsed } from "@/lib/status";
import { isOrchestratorTask } from "@/lib/taskGroups";
import { taskLabel } from "@/lib/taskLabel";
import { cn } from "@/lib/utils";
import type { TaskInfo } from "@/protocol";

import { FactoryStageChip } from "./Sidebar/FactoryStageChip";
import {
  LANE_GLYPH_PX,
  LANE_META_PX,
  LANE_TWISTY_PX,
  sidebarContentLeft,
  SIDEBAR_STATE_META,
  sidebarTwistyLeft,
  snoozeWakeLabel,
  type SidebarTaskState,
} from "./Sidebar/logic";
import { RowGutter } from "./Sidebar/RowGutter";
import { SidebarTaskTooltipBody } from "./Sidebar/SidebarTaskTooltip";
import { STATE_ICON } from "./Sidebar/stateIcons";
import { RowActions } from "./Sidebar/TaskRowActions";

/**
 * One task row. Anatomy, left to right:
 *
 *   [gutter][twisty] [status glyph] title …         [agent] [elapsed]
 *                                                   └ swapped for row actions
 *                                                     on hover / focus
 *
 * Every lane is fixed and shared (spec 08 §C.1): the gutter is `depth × 12px`
 * with the tree rail absolutely positioned inside it, then a 16px twisty lane,
 * a 16px glyph, the flexing title, and a 68px meta lane. Indent is the button's
 * `padding-left`, so the row fills the list width and hover/active never
 * stair-step; it is not `margin-left`.
 *
 * The glyph is not a reserved column (spec 08 §C.1, owner override): only the
 * four states with `SIDEBAR_STATE_META.rowGlyph` draw one, and a silent row's
 * title starts where that glyph would have.
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

export interface SidebarTaskRowProps {
  task: TaskInfo;
  state: SidebarTaskState;
  depth: number;
  ancestorLines: readonly boolean[];
  isLast: boolean;
  activeLane: number | null;
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
  activeLane,
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
  const factory = isFactoryTask(task);
  const pipeline = factory && (childCount > 0 || task.workflowRun != null);

  return (
    <div className="group/row relative" data-rail-depth={depth}>
      <RowGutter
        depth={depth}
        ancestorLines={ancestorLines}
        isLast={isLast}
        activeLane={activeLane}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-task-id={task.id}
            data-task-state={state}
            onClick={() => onOpen(task.id)}
            aria-label={`Open task: ${label}`}
            style={{ paddingLeft: sidebarContentLeft(depth) }}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-md pr-1.5 text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
              active ? "font-medium text-foreground" : "hover:bg-accent/60",
            )}
          >
            {/* Inline, not a reserved lane: most rows are silent, so a
                placeholder column would indent the whole list for the minority
                that draws one. Its box is the glyph lane, so a glyphed title
                lands on the project name's column. */}
            {meta.rowGlyph && (
              // WKWebView can stall a spin on a bare <svg> until something else
              // repaints; an HTML box with its own layer keeps it on the compositor.
              <span
                aria-hidden
                data-task-glyph={state}
                style={{ height: LANE_GLYPH_PX, width: LANE_GLYPH_PX }}
                className={cn(
                  "inline-flex shrink-0",
                  meta.toneClass,
                  meta.live &&
                    "animate-[spin_3s_linear_infinite] will-change-transform motion-reduce:animate-none",
                )}
              >
                <StateIcon className="size-full" />
              </span>
            )}
            <span
              data-lane="title"
              className={cn(
                "min-w-0 flex-1 truncate text-[13px] leading-none",
                active ? "font-medium text-foreground" : meta.titleClass,
              )}
            >
              {label}
            </span>
            {factory && <FactoryStageChip task={task} receded={receded} />}
            {task.worktree && !factory && (
              <TaskPullRequestGlyph taskId={task.id} receded={receded} />
            )}
            {pipeline ? (
              <span
                title={
                  childCount > 0
                    ? `Factory pipeline · ${childCount} stage${childCount === 1 ? "" : "s"}`
                    : "Factory pipeline"
                }
                className="inline-flex shrink-0"
              >
                <Workflow aria-hidden className="size-3 text-muted-foreground/60" />
              </span>
            ) : (
              orchestrator && (
                <span title="Orchestrator lead" className="inline-flex shrink-0">
                  <Users aria-hidden className="size-3 text-muted-foreground/60" />
                </span>
              )
            )}
            <span
              data-lane="meta"
              style={{ width: LANE_META_PX }}
              className="relative ml-auto flex h-6 shrink-0 items-center justify-end gap-1 transition-opacity group-hover/row:opacity-0 group-focus-within/row:opacity-0"
            >
              {childCount > 0 && (
                <span className="tnum w-4 text-right text-[11px] text-muted-foreground/45">
                  {childCount}
                </span>
              )}
              <AgentLogo
                agentId={task.agent}
                displayName={task.agent}
                className={cn("size-3.5 shrink-0", receded && "opacity-40 grayscale")}
              />
              {state === "snoozed" ? (
                <span className="tnum w-7 text-right text-[11px] text-info/80">
                  {snoozeWakeLabel(task.snoozedUntil!, nowSec)}
                </span>
              ) : (
                <span className="tnum w-7 text-right text-[11px] text-muted-foreground/50">
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
          style={{ height: LANE_TWISTY_PX, left: sidebarTwistyLeft(depth), width: LANE_TWISTY_PX }}
          className="absolute top-1/2 grid -translate-y-1/2 place-items-center rounded text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ChevronRight
            aria-hidden
            className={cn("size-3 transition-transform", expanded && "rotate-90")}
          />
        </button>
      )}

      <RowActions task={task} state={state} pinned={pinned} factory={factory} onPin={onPin} />
    </div>
  );
});
