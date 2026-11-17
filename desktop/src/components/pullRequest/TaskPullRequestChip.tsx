import { ArrowUpRight, Archive } from "lucide-react";
import { useState } from "react";

import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { useTaskKeepers } from "@/hooks/useTaskKeepers";
import { useOpenTaskPullRequestRefresh, useTaskPullRequest } from "@/hooks/useTaskPullRequest";
import { copyText } from "@/lib/clipboard";
import { openExternalLink } from "@/lib/externalLinks";
import { keeperWorst } from "@/lib/keepers";
import { cn } from "@/lib/utils";
import type { TaskInfo } from "@/protocol";

import { ArchiveMergedTaskDialog } from "./ArchiveMergedTaskDialog";
import { KeeperDot, withKeeperLabel } from "./KeeperDot";
import { liveChecks, PULL_CHECKS_META, PULL_STATE_META, pullRequestSummary } from "./meta";
import { openPullRequest, openTaskPullRequest } from "./taskPullRequestNavigation";

const CHIP =
  "flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-px text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * The open task's pull request in the header: state and checks, opening the
 * review inside Warpforge. Once it is merged, the next step is offered beside
 * it — archive the task and remove its worktree, after a confirmation.
 */
export function TaskPullRequestChip({
  task,
  compact = false,
}: {
  task: TaskInfo;
  compact?: boolean;
}) {
  return compact ? <ChipContent task={task} compact /> : <RefreshingChip task={task} />;
}

function RefreshingChip({ task }: { task: TaskInfo }) {
  useOpenTaskPullRequestRefresh(task.id);
  return <ChipContent task={task} compact={false} />;
}

function ChipContent({ task, compact }: { task: TaskInfo; compact: boolean }) {
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
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <span className="inline-flex shrink-0">
            <button
              type="button"
              data-task-pr={pr.state}
              aria-label={`${summary}: open in Warpforge`}
              title={pr.title}
              onClick={(event) => openPullRequest(task.id, pr.url, event)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ")
                  openPullRequest(task.id, pr.url, event);
              }}
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
            <button
              type="button"
              aria-label="Open on GitHub"
              className={CHIP}
              onClick={() => void openExternalLink(pr.url)}
            >
              <ArrowUpRight aria-hidden className="size-3" />
            </button>
          </span>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => openTaskPullRequest(task.id)}>
            Open in Warpforge
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void openExternalLink(pr.url)}>
            Open on GitHub
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void copyText(pr.url, "pull request link")}>
            Copy link
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {!compact && pr.state === "merged" && task.worktree && (
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
