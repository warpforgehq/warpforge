import { Archive } from "lucide-react";
import { useState } from "react";

import { useTaskKeepers } from "@/hooks/useTaskKeepers";
import { useOpenTaskPullRequestRefresh, useTaskPullRequest } from "@/hooks/useTaskPullRequest";
import { openExternalLink } from "@/lib/externalLinks";
import { keeperWorst } from "@/lib/keepers";
import { cn } from "@/lib/utils";
import type { TaskInfo } from "@/protocol";

import { ArchiveMergedTaskDialog } from "./ArchiveMergedTaskDialog";
import { KeeperDot, withKeeperLabel } from "./KeeperDot";
import { liveChecks, PULL_CHECKS_META, PULL_STATE_META, pullRequestSummary } from "./meta";

const CHIP =
  "flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-px text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * The open task's pull request in the header: state and checks, opening the
 * pull request on GitHub. Once it is merged, the next step is offered beside
 * it — archive the task and remove its worktree, after a confirmation.
 */
export function TaskPullRequestChip({ task }: { task: TaskInfo }) {
  useOpenTaskPullRequestRefresh(task.id);
  const pr = useTaskPullRequest(task.id);
  const keepers = keeperWorst(useTaskKeepers(task.id));
  const [confirming, setConfirming] = useState(false);
  if (!pr) return null;
  const state = PULL_STATE_META[pr.state];
  const checks = liveChecks(pr);
  const StateIcon = state.icon;
  const ChecksIcon = checks ? PULL_CHECKS_META[checks].icon : null;
  const summary = withKeeperLabel(pullRequestSummary(pr), keepers);

  return (
    <>
      <button
        type="button"
        data-task-pr={pr.state}
        aria-label={`${summary}: open on GitHub`}
        title={pr.title}
        onClick={() => void openExternalLink(pr.url)}
        className={CHIP}
      >
        <span className="relative inline-flex shrink-0">
          <StateIcon aria-hidden className={cn("size-3", state.toneClass)} />
          <KeeperDot worst={keepers} />
        </span>
        <span className="tnum">#{pr.number}</span>
        {state.label}
        {checks && ChecksIcon && (
          <span
            data-task-pr-checks={checks}
            className={cn("flex items-center gap-0.5", PULL_CHECKS_META[checks].toneClass)}
          >
            <ChecksIcon aria-hidden className="size-3 shrink-0" />
            {PULL_CHECKS_META[checks].label}
          </span>
        )}
      </button>
      {pr.state === "merged" && task.worktree && (
        <>
          <button type="button" onClick={() => setConfirming(true)} className={CHIP}>
            <Archive aria-hidden className="size-3 shrink-0" />
            Archive and remove worktree
          </button>
          <ArchiveMergedTaskDialog
            task={task}
            pr={pr}
            open={confirming}
            onOpenChange={setConfirming}
          />
        </>
      )}
    </>
  );
}
