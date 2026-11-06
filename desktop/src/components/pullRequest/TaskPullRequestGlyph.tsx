import { useTaskPullRequest } from "@/hooks/useTaskPullRequest";
import { cn } from "@/lib/utils";

import { KEEPER_WORST_META, KeeperDot, useKeeperWorst } from "./KeeperDot";
import { liveChecks, PULL_CHECKS_META, PULL_STATE_META, pullRequestSummary } from "./meta";

/**
 * The sidebar row's pull-request mark: the state glyph in its colour, with a
 * dot for checks that failed or are still running. Passing checks draw no dot;
 * a row full of green dots would say nothing. A second dot, top right, is
 * the task's keepers.
 */
export function TaskPullRequestGlyph({ taskId, receded }: { taskId: string; receded: boolean }) {
  const pr = useTaskPullRequest(taskId);
  const keepers = useKeeperWorst(taskId);
  if (!pr) return null;
  const meta = PULL_STATE_META[pr.state];
  const checks = liveChecks(pr);
  const Icon = meta.icon;
  const summary = [pullRequestSummary(pr), keepers && KEEPER_WORST_META[keepers].label]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
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
