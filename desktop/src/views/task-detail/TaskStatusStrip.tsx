import { Loader2 } from "lucide-react";
import { useSyncExternalStore } from "react";

import { TaskAccountMenu } from "@/components/TaskAccountMenu";
import { daemon } from "@/daemon";
import { cn } from "@/lib/utils";
import type { TaskInfo } from "@/protocol";

import { GitWorkspaceControls } from "./GitWorkspaceControls";

interface Props {
  task: TaskInfo;
  branch: string | null;
  repositoryOperation: { kind: string } | null;
  onOpenCommit: () => void;
  onOpenPush: () => void;
}

/**
 * The task's footer: its harness, account and quota on the left, git state on
 * the right. Switching the account still moves the harness's global login.
 *
 * @param task the open task
 * @param branch the task's current branch, when known
 * @param repositoryOperation the pull or push in flight, if any
 * @param onOpenCommit opens the commit dialog
 * @param onOpenPush opens the push dialog
 */
export function TaskStatusStrip({
  task,
  branch,
  repositoryOperation,
  onOpenCommit,
  onOpenPush,
}: Props) {
  const { snapshot } = useSyncExternalStore(daemon.subscribe, daemon.getState);
  return (
    <div className="flex h-6 shrink-0 items-center gap-2 pl-0.5 pr-1 text-[11px] text-muted-foreground">
      <TaskAccountMenu
        agentId={task.agent}
        agents={snapshot.agents ?? []}
        accounts={snapshot.accounts ?? []}
      />
      {repositoryOperation && (
        <span className="ml-auto mr-2 flex shrink-0 items-center gap-1 text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {repositoryOperation.kind === "pull" ? "Pulling from remote…" : "Pushing to remote…"}
        </span>
      )}
      <span className={cn("flex items-center gap-2", !repositoryOperation && "ml-auto")}>
        <GitWorkspaceControls
          taskId={task.id}
          branch={branch}
          onOpenCommit={onOpenCommit}
          onOpenPush={onOpenPush}
        />
      </span>
    </div>
  );
}
