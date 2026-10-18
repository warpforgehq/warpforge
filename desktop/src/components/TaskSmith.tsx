import { AgentLogo } from "@/components/AgentLogo";
import { SmithAvatar } from "@/components/SmithAvatar";
import { agentDisplayName } from "@/lib/agentNames";
import { cn } from "@/lib/utils";
import type { Smith, TaskInfo } from "@/protocol";
import { useSmithsStore } from "@/store/smiths";
import { useUi } from "@/store/ui";

/**
 * @param task a task
 * @returns the Smith it runs as, when it runs as one the app knows
 */
export function useTaskSmith(task: Pick<TaskInfo, "smithId">): Smith | undefined {
  return useSmithsStore((state) => (task.smithId ? state.smiths[task.smithId] : undefined));
}

/**
 * The harness logo of a task, or in its place the avatar of the Smith it runs
 * as, with the harness kept in the tooltip.
 * @param props.task the task
 * @param props.className sizing and dimming for the slot
 * @returns the mark
 */
export function TaskAgentMark({
  task,
  className,
}: {
  task: Pick<TaskInfo, "agent" | "smithId">;
  className?: string;
}) {
  const smith = useTaskSmith(task);
  if (!smith) {
    return <AgentLogo agentId={task.agent} displayName={task.agent} className={className} />;
  }
  return (
    <span
      title={`${smith.name} · ${agentDisplayName(task.agent)}`}
      className={cn("inline-flex shrink-0", className)}
    >
      <SmithAvatar smith={smith} size="size-full" className="size-full [&>span]:text-[8px]" />
    </span>
  );
}

/**
 * "Ada ·" before a task's title: the avatar and name of the Smith it runs as.
 * @param props.task the task
 * @param props.interactive a button that opens the Smith's page; plain inside
 *   another control
 * @returns the byline, or nothing for a task no Smith runs
 */
export function TaskSmithByline({
  task,
  interactive = false,
  className,
}: {
  task: Pick<TaskInfo, "smithId">;
  interactive?: boolean;
  className?: string;
}) {
  const smith = useTaskSmith(task);
  if (!smith) return null;
  const body = (
    <>
      <SmithAvatar smith={smith} size="size-4" className="[&>span]:text-[9px]" />
      <span className="truncate">{smith.name}</span>
      <span aria-hidden className="text-muted-foreground/60">
        ·
      </span>
    </>
  );
  const look = cn(
    "flex min-w-0 shrink-0 items-center gap-1 text-[13px] font-medium text-foreground",
    className,
  );
  if (!interactive) return <span className={look}>{body}</span>;
  return (
    <button
      type="button"
      title={`Open ${smith.name}`}
      onClick={() => {
        const ui = useUi.getState();
        ui.setSidebarMode("team");
        ui.openTeam({ id: smith.id, kind: "teammate" });
      }}
      className={cn(look, "rounded hover:text-primary")}
    >
      {body}
    </button>
  );
}
