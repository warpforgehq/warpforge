import { useUi } from "@/store/ui";

/** Reveal the task's review even when its workspace was folded. */
export function openTaskPullRequest(taskId: string) {
  const ui = useUi.getState();
  if (ui.openTaskId !== taskId) ui.openTask(taskId);
  useUi.setState({ activeSurface: "pull-request", showDiff: true, sidebarMode: "tasks" });
}
