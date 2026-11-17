import { useTaskKeepers } from "@/hooks/useTaskKeepers";
import { useTaskPullRequest } from "@/hooks/useTaskPullRequest";
import { openExternalLink } from "@/lib/externalLinks";
import { keeperWorst } from "@/lib/keepers";
import { cn } from "@/lib/utils";

import { KeeperDot, withKeeperLabel } from "./KeeperDot";
import { liveChecks, PULL_CHECKS_META, PULL_STATE_META, pullRequestSummary } from "./meta";
import { openTaskPullRequest } from "./taskPullRequestNavigation";

/**
 * The sidebar row's pull-request mark: the state glyph in its colour, with a
 * dot for checks that failed or are still running. Passing checks draw no dot;
 * a row full of green dots would say nothing.
 */
export function TaskPullRequestGlyph({ taskId, receded }: { taskId: string; receded: boolean }) {
  const pr = useTaskPullRequest(taskId);
  const keepers = keeperWorst(useTaskKeepers(taskId));
  if (!pr) return null;
  const meta = PULL_STATE_META[pr.state];
  const checks = liveChecks(pr);
  const Icon = meta.icon;
  const summary = withKeeperLabel(pullRequestSummary(pr), keepers);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        if (event.metaKey || event.ctrlKey) void openExternalLink(pr.url);
        else openTaskPullRequest(taskId);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          openTaskPullRequest(taskId);
        }
      }}
      data-task-pr={pr.state}
      title={summary}
      className={cn("relative inline-flex shrink-0", receded && "opacity-50")}
    >
      <Icon aria-hidden className={cn("size-3", meta.toneClass)} />
      {checks && checks !== "passing" && (
        <span
          aria-hidden
          data-task-pr-checks={checks}
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ring-1 ring-background",
            PULL_CHECKS_META[checks].dotClass,
          )}
        />
      )}
      <KeeperDot worst={keepers} />
      <span className="sr-only">{summary}</span>
    </span>
  );
}
