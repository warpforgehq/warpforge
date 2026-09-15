import {
  AlarmClock,
  CircleAlert,
  FileDiff,
  FolderTree,
  GitBranch,
  Layers,
  type LucideIcon,
} from "lucide-react";

import { AgentLogo } from "@/components/AgentLogo";
import { agentDisplayName } from "@/lib/agentNames";
import { elapsed } from "@/lib/status";
import { isOrchestratorTask } from "@/lib/taskGroups";
import { taskLabel } from "@/lib/taskLabel";
import { cn } from "@/lib/utils";
import type { TaskInfo } from "@/protocol";

import { SIDEBAR_STATE_META, isSnoozed, snoozeWakeLabel, type SidebarTaskState } from "./logic";
import { STATE_ICON } from "./stateIcons";

function TooltipLine({
  icon: Icon,
  children,
  tone,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-2", tone)}>
      <Icon aria-hidden className="mt-px size-3.5 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

/**
 * Everything that does not fit on the row: project, worktree, agent, size of
 * the change, and why the task is stuck. Exported so the content can be
 * asserted without driving a Radix hover.
 */
export function SidebarTaskTooltipBody({
  task,
  state,
  childCount,
  nowSec,
}: {
  task: TaskInfo;
  state: SidebarTaskState;
  childCount: number;
  nowSec: number;
}) {
  const meta = SIDEBAR_STATE_META[state];
  const StateIcon = STATE_ICON[meta.icon];
  const worktree = task.worktree ?? null;
  const orchestrator = isOrchestratorTask(task, childCount);
  return (
    <div className="flex max-w-[17rem] flex-col gap-2 p-1">
      <div className="text-[13px] font-medium leading-snug text-foreground">{taskLabel(task)}</div>
      <div className="grid gap-1.5 text-[11px] text-muted-foreground">
        <TooltipLine icon={StateIcon} tone={meta.toneClass}>
          <span className="text-foreground/85">{meta.label}</span>
          <span className="text-muted-foreground/60"> · </span>
          <span className="tnum text-muted-foreground/80">{elapsed(task.updatedAt)} ago</span>
        </TooltipLine>
        <TooltipLine icon={FolderTree}>{task.project}</TooltipLine>
        {worktree && (
          <TooltipLine icon={GitBranch}>
            <span className="font-mono text-[11px]">{worktree}</span>
          </TooltipLine>
        )}
        <div className="flex min-w-0 items-start gap-2">
          <AgentLogo
            agentId={task.agent}
            displayName={task.agent}
            className="mt-px size-3.5 opacity-80"
          />
          <span className="min-w-0 flex-1 break-words">{agentDisplayName(task.agent)}</span>
        </div>
        {childCount > 0 && (
          <TooltipLine icon={Layers}>
            {childCount} subtask{childCount === 1 ? "" : "s"}
            {orchestrator ? " · Lead" : ""}
          </TooltipLine>
        )}
        {orchestrator && childCount === 0 && (
          <TooltipLine icon={Layers}>Orchestrator lead — no workers yet</TooltipLine>
        )}
        {task.filesChanged > 0 && (
          <TooltipLine icon={FileDiff}>
            <span className="tnum">{task.filesChanged}</span> file
            {task.filesChanged === 1 ? "" : "s"} changed
          </TooltipLine>
        )}
        {isSnoozed(task, nowSec) && (
          <TooltipLine icon={AlarmClock} tone="text-info">
            back in <span className="tnum">{snoozeWakeLabel(task.snoozedUntil!, nowSec)}</span>
          </TooltipLine>
        )}
        {task.blockedReason && (
          <TooltipLine icon={CircleAlert} tone="text-destructive">
            {task.blockedReason}
          </TooltipLine>
        )}
      </div>
    </div>
  );
}
