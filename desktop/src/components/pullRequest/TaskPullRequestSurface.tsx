import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { InboxDetailPane } from "@/components/inbox/InboxDetailPane";
import { daemon } from "@/daemon";
import { useTaskPullRequest } from "@/hooks/useTaskPullRequest";
import { inboxItemKey, markInboxItemSeen } from "@/lib/inboxSeen";
import type { PullRequestSummary, TaskInfo } from "@/protocol";

/** Open by the task's identity, independently of inbox listing and filters. */
export function TaskPullRequestSurface({ task }: { task: TaskInfo }) {
  const pr = useTaskPullRequest(task.id);
  const details = useQuery({
    enabled: !!pr,
    queryFn: () => daemon.pullDetails(task.project, pr!.number),
    queryKey: ["pull", "details", task.project, pr?.number],
  });
  const repo = pr?.url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/)?.[1];
  const updatedAt = details.data?.updatedAt ?? 0;
  useEffect(() => {
    if (repo && pr && updatedAt)
      markInboxItemSeen({ key: inboxItemKey({ repo, number: pr.number }), updatedAt: updatedAt });
  }, [repo, pr, updatedAt]);
  if (!pr || !repo) return <p className="p-3">Pull request unavailable.</p>;
  if (details.isPending) return <p className="p-3">Loading pull request…</p>;
  if (details.error)
    return (
      <p className="p-3">
        Could not load pull request. <button onClick={() => void details.refetch()}>Retry</button>
      </p>
    );
  const summary: PullRequestSummary = {
    ...details.data,
    project: task.project,
    repo,
    number: pr.number,
    labels: [],
    assignees: [],
    createdAt: 0,
    updatedAt: updatedAt,
  };
  return <InboxDetailPane pr={summary} />;
}
