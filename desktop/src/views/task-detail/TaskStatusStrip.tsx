import { Loader2 } from "lucide-react";
import { useSyncExternalStore } from "react";

import { daemon } from "@/daemon";
import { isChat } from "@/lib/taskKind";
import type { TaskInfo } from "@/protocol";

import { AdvisorIndicator } from "./AdvisorIndicator";
import { ChatFolderButton } from "./ChatFolderButton";
import { ContinueInProject } from "./ContinueInProject";
import { CreateProjectFromChat } from "./CreateProjectFromChat";
import { GitWorkspaceControls } from "./GitWorkspaceControls";

interface Props {
  task: TaskInfo;
  branch: string | null;
  repositoryOperation: { kind: string } | null;
  onOpenCommit: () => void;
  onOpenPush: () => void;
}

/**
 * The task's advisor, repository activity and git state, shown in the window's
 * title row. The account and quota live at the foot of the workspace rail.
 *
 * @param task the open task
 * @param branch the task's current branch, when known
 * @param repositoryOperation the pull or push in flight, if any
 * @param onOpenCommit opens the commit dialog
 * @param onOpenPush opens Diff → History
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
    <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
      {task.advisor && <AdvisorIndicator advisor={task.advisor} agents={snapshot.agents ?? []} />}
      {repositoryOperation && (
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {repositoryOperation.kind === "pull" ? "Pulling from remote…" : "Pushing to remote…"}
        </span>
      )}
      <span className="flex items-center gap-2">
        {isChat(task) ? (
          <>
            <ContinueInProject task={task} />
            <CreateProjectFromChat task={task} />
            <ChatFolderButton taskId={task.id} />
          </>
        ) : (
          <GitWorkspaceControls
            taskId={task.id}
            branch={branch}
            task={task}
            onOpenCommit={onOpenCommit}
            onOpenPush={onOpenPush}
          />
        )}
      </span>
    </div>
  );
}
