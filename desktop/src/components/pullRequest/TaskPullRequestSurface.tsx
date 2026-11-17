import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { InboxDetailPane } from "@/components/inbox/InboxDetailPane";
import { PullOverviewSkeleton } from "@/components/inbox/PullOverviewSkeleton";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { daemon } from "@/daemon";
import { useTaskPullRequest } from "@/hooks/useTaskPullRequest";
import { inboxItemKey, markInboxItemSeen } from "@/lib/inboxSeen";
import type { PullRequestSummary, TaskInfo, TaskPullRequest } from "@/protocol";

import { pullRequestRepo } from "./taskPullRequestNavigation";

/** Open by the task's identity, independently of inbox listing and filters. */
export function TaskPullRequestSurface({ task }: { task: TaskInfo }) {
  const pr = useTaskPullRequest(task.id);
  if (!pr) return <EmptyState title="Pull request unavailable." />;
  return <PullRequestDetails task={task} pr={pr} />;
}

function PullRequestDetails({ task, pr }: { task: TaskInfo; pr: TaskPullRequest }) {
  const details = useQuery({
    queryFn: () => daemon.pullDetails(task.project, pr.number),
    queryKey: ["pull", "details", task.project, pr.number],
  });
  const repo = pullRequestRepo(pr.url);
  const updatedAt = details.data?.updatedAt ?? 0;
  useEffect(() => {
    if (repo && updatedAt)
      markInboxItemSeen({ key: inboxItemKey({ repo, number: pr.number }), updatedAt });
  }, [repo, pr, updatedAt]);
  if (!repo) return <EmptyState title="Pull request unavailable." />;
  if (details.isPending) return <PullOverviewSkeleton variant="description" />;
  if (details.error)
    return (
      <EmptyState
        role="alert"
        title="Could not load pull request."
        action={
          <Button type="button" size="sm" variant="outline" onClick={() => void details.refetch()}>
            Retry
          </Button>
        }
      />
    );
  const summary: PullRequestSummary = {
    ...details.data,
    project: task.project,
    repo,
    number: pr.number,
    labels: [],
    assignees: [],
    createdAt: 0,
    updatedAt,
  };
  return <InboxDetailPane pr={summary} />;
}
