import { useSyncExternalStore } from "react";

import { daemon } from "@/daemon";
import type { PullRequestSummary } from "@/protocol";

import { openTaskPullRequest } from "./taskPullRequestNavigation";

/** Return to the task that owns this pull request, when the cache knows it. */
export function PullRequestTaskLink({ pr }: { pr: PullRequestSummary }) {
  const taskId = useSyncExternalStore(
    daemon.subscribe,
    () => {
      const cache = daemon.getState().taskPullRequests ?? {};
      return (
        Object.entries(cache).find(
          ([, pull]) =>
            pull &&
            (pull.url === pr.url ||
              (pull.number === pr.number &&
                pull.url
                  .toLowerCase()
                  .startsWith(`https://github.com/${pr.repo.toLowerCase()}/pull/`))),
        )?.[0] ?? null
      );
    },
    () => null,
  );
  if (!taskId) return null;
  return (
    <button
      type="button"
      className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation();
        openTaskPullRequest(taskId);
      }}
    >
      → task
    </button>
  );
}
