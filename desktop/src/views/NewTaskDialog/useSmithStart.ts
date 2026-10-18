import { toast } from "sonner";

import { daemon } from "../../daemon";
import type { PromptSubmission, Smith } from "../../protocol";
import { useUi } from "../../store/ui";

/**
 * Start the prompt as a work session of the picked Smith instead of a plain
 * task: its agent, model, account and permissions are the Smith's own.
 * @param props.smith the Smith picked, if any
 * @param props.project the project to work in
 * @param props.useWorktree whether to work in an isolated worktree
 * @param props.orchestrator whether it leads as an orchestrator
 * @param props.backlogItemId the backlog item the work comes from, if any
 * @param props.close closes New Task
 * @param props.onCreated called with the new task's id
 * @returns the start action
 */
export function useSmithStart({
  smith,
  project,
  useWorktree,
  orchestrator,
  backlogItemId,
  close,
  onCreated,
}: {
  smith: Smith | undefined;
  project: string;
  useWorktree: boolean;
  orchestrator: boolean;
  backlogItemId?: string | null;
  close: () => void;
  onCreated?: (taskId: string) => void;
}) {
  const revealTask = useUi((state) => state.revealTask);
  return async (submission: PromptSubmission) => {
    const brief = submission.text.trim();
    if (!smith || !brief || !project) return;
    if (submission.attachments.length > 0) {
      toast.error(`${smith.name} takes a text brief only`, {
        description: "Remove the attachments, or start a plain task with them.",
      });
      return;
    }
    let taskId: string;
    try {
      taskId = await daemon.startSmithWork(smith.id, {
        backlogItemId,
        brief,
        orchestrator,
        project,
        // A lead and its workers share the checkout, as for any orchestrator.
        worktree: orchestrator ? false : useWorktree,
      });
    } catch (error) {
      toast.error(`Could not start ${smith.name}'s work`, {
        description: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    onCreated?.(taskId);
    revealTask(taskId);
    toast.success(`${smith.name} started`, {
      description: orchestrator ? `Leading in ${project}` : `Work session in ${project}`,
    });
    close();
  };
}
