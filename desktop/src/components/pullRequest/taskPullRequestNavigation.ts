import type { KeyboardEvent, MouseEvent } from "react";

import { openExternalLink } from "@/lib/externalLinks";
import { useUi } from "@/store/ui";

/** Reveal the task's review even when its workspace was folded. */
export function openTaskPullRequest(taskId: string) {
  const ui = useUi.getState();
  if (ui.openTaskId !== taskId) ui.openTask(taskId);
  useUi.setState({ activeSurface: "pull-request", showDiff: true, sidebarMode: "tasks" });
}

/** Activate a task PR consistently from pointer and keyboard controls. */
export function openPullRequest(taskId: string, url: string, event: MouseEvent | KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
  if (event.metaKey || event.ctrlKey) void openExternalLink(url);
  else openTaskPullRequest(taskId);
}

/** Repository identity shared by task and inbox PR surfaces. */
export function pullRequestRepo(url: string): string | null {
  return url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+(?:[/?#]|$)/i)?.[1] ?? null;
}
