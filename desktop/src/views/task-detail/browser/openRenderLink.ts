import { daemon } from "@/daemon";
import { openExternalLink } from "@/lib/externalLinks";
import { IS_TAURI } from "@/lib/platform";
import { useUi } from "@/store/ui";

import { openUrlInBrowser } from "./browserSession";

/**
 * Open a link clicked in an agent's page in the task's in-app browser, and
 * show the task with its browser surface. Outside the desktop app, or for a
 * task without a project, the link opens in the system browser.
 * @param taskId the task whose chat shows the page
 * @param url an http(s) address
 */
export function openRenderLink(taskId: string | undefined, url: string): void {
  const project = taskId
    ? daemon.getState().snapshot.tasks.find((task) => task.id === taskId)?.project
    : undefined;
  if (!IS_TAURI || !taskId || !project) {
    void openExternalLink(url);
    return;
  }
  openUrlInBrowser(project, url);
  const ui = useUi.getState();
  if (ui.openTaskId !== taskId) ui.openTask(taskId);
  ui.setShowDiff(true);
  ui.setActiveSurface("browser");
}
