import { GitPullRequest } from "lucide-react";

import { PullRequestDetail } from "@/components/inbox/PullRequestDetail";
import { EmptyState } from "@/components/ui/empty-state";
import type { PullRequestSummary } from "@/protocol";

/**
 * The review side of the inbox: whatever pull request the list has selected,
 * filling every pixel the list rail does not take. One component serves both
 * inbox contexts — the cross-project view and a single project's Pull
 * Requests tab — so their behaviours can't drift apart.
 *
 * This used to be a docked overlay capped at 42rem. Reviewing a diff is the
 * whole point of the surface, so it gets the pane, not a drawer.
 */
export function InboxDetailPane({
  pr,
  onSendToAgent,
}: {
  pr: PullRequestSummary | null;
  onSendToAgent?: (pr: PullRequestSummary, prompt: string) => void;
}) {
  if (!pr) {
    return (
      <EmptyState
        className="h-full"
        icon={GitPullRequest}
        title="Select a pull request to review"
      />
    );
  }
  return (
    <PullRequestDetail
      // A different pull request is a different review: local state (which
      // tab, which files are expanded) must not survive the switch.
      key={`${pr.project}:${pr.number}`}
      pr={pr}
      onSendToAgent={onSendToAgent}
    />
  );
}
