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
import { KEEPER_WORST_META, withKeeperLabel } from "./KeeperDot";
import { liveChecks, PULL_CHECKS_META, PULL_STATE_META, pullRequestSummary } from "./meta";
import { openPullRequest, openTaskPullRequest } from "./taskPullRequestNavigation";

const CHIP =
  "flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-px text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function Led({ className, ...rest }: { className: string; [data: `data-${string}`]: string }) {
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", className)} {...rest} />;
}

/**
 * The open task's pull request in the header: state and checks, opening the
 * review inside Warpforge. Once it is merged, the next step is offered beside
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
  const summary = withKeeperLabel(pullRequestSummary(pr), keepers);
  const failed = checks === "failing" ? (pr.failedChecks?.length ?? 0) : 0;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <span className="group inline-flex shrink-0 items-center rounded border border-border text-[11px] text-muted-foreground transition-colors hover:border-foreground/20">
            <button
              type="button"
              data-task-pr={pr.state}
              aria-label={`${summary}: open in Warpforge`}
              title={`${pr.title}\n${summary}\n⌘-click to open on GitHub`}
              onClick={(event) => openPullRequest(task.id, pr.url, event)}
              className="flex items-center gap-1.5 rounded-l py-px pr-1 pl-1.5 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <StateIcon aria-hidden className={cn("size-3 shrink-0", state.toneClass)} />
              <span className="font-mono tnum">#{pr.number}</span>
              {pr.state !== "open" && <span>{state.label}</span>}
              {checks && (
                <Led
                  data-task-pr-checks={checks}
                  className={cn(
                    PULL_CHECKS_META[checks].dotClass,
                    checks === "pending" && "motion-safe:animate-pulse",
                  )}
                />
              )}
              {failed > 0 && <span className="font-mono text-destructive">{failed} failing</span>}
              {keepers && (
                <Led data-task-keepers={keepers} className={KEEPER_WORST_META[keepers].dotClass} />
              )}
            </button>
            <button
              type="button"
              aria-label="Open on GitHub"
              title="Open on GitHub"
              className="grid max-w-0 self-stretch place-items-center overflow-hidden rounded-r px-0 opacity-0 transition-all group-hover:max-w-6 group-hover:px-1 group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:max-w-6 focus-visible:px-1 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
