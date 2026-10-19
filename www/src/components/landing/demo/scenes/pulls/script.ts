/**
 * The task's pull request comes back with a failing check and a review
 * comment, the task lands in Needs you, then the visitor is taken to the PR
 * in the inbox — the same review a person would open next.
 */
import type { DaemonEvent, TaskPullRequest } from "@app/protocol";

import type { Beat } from "../types";
import { failingCheck, PR_TASK_ID, REPO, taskPull, type timeline } from "./fixtures";

const pull = (pr: TaskPullRequest): DaemonEvent => ({
  data: { pull_request: pr, task_id: PR_TASK_ID },
  event: "task.pullRequest",
});

/**
 * @param world The pull requests as this pass of the scene made them.
 * @returns The scene's beats.
 */
export function pullsScript(world: ReturnType<typeof timeline>): Beat[] {
  return [
    { after: 300, event: pull(taskPull()) },
    {
      after: 2600,
      event: pull(
        taskPull({
          checks: "failing",
          failedChecks: [failingCheck],
          openComments: [world.reviewComment],
        }),
      ),
    },
    {
      after: 5200,
      ui: {
        inboxSelectedKey: `${REPO}#${world.summary.number}`,
        openTaskId: null,
        sidebarMode: "inbox",
        view: "inbox",
      },
    },
  ];
}
