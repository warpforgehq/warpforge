import {
  liveChecks,
  PULL_CHECKS_META,
  PULL_STATE_META,
  pullRequestSummary,
} from "@/components/pullRequest/meta";
import { useFactoryEntry } from "@/hooks/useRunner";
import { useTaskPullRequest } from "@/hooks/useTaskPullRequest";
import { openExternalLink } from "@/lib/externalLinks";
import { factoryStage, factoryWait, waitSentence } from "@/lib/factory";
import { cn } from "@/lib/utils";
import type { TaskInfo } from "@/protocol";

/**
 * Where a Factory task is, on its sidebar row: Queued (with why, on hover),
 * the stage it runs, Opening PR, or its pull request. A pull request takes the
 * chip over, carrying its state (colour) and checks (a dot), and opens it.
 * @param props.task A Factory task.
 * @param props.receded Whether the row is history.
 */
export function FactoryStageChip({ task, receded }: { task: TaskInfo; receded: boolean }) {
  const { entry, status } = useFactoryEntry(task);
  const pr = useTaskPullRequest(task.id);

  if (pr) {
    const state = PULL_STATE_META[pr.state];
    const checks = liveChecks(pr);
    const summary = pullRequestSummary(pr);
    const StateIcon = state.icon;
    return (
      <span
        role="button"
        tabIndex={0}
        data-factory-pr={pr.state}
        aria-label={`${summary} — click to open on GitHub`}
        title={`${summary} — click to open on GitHub`}
        onClick={(event) => {
          event.stopPropagation();
          void openExternalLink(pr.url);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          void openExternalLink(pr.url);
        }}
        className={cn(
          "inline-flex max-w-[8.5rem] shrink-0 items-center gap-1 rounded px-1 text-[0.6875rem] leading-4 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          state.chipClass,
          receded && "opacity-50",
        )}
      >
        <StateIcon aria-hidden className="size-3 shrink-0" />
        <span className="truncate">PR #{pr.number}</span>
        {checks && checks !== "passing" && (
          <span
            aria-hidden
            data-task-pr-checks={checks}
            className={cn("size-1.5 shrink-0 rounded-full", PULL_CHECKS_META[checks].dotClass)}
          />
        )}
      </span>
    );
  }

  const label = factoryStage(task, entry, null);
  if (!label) return null;
  const wait = factoryWait(entry, status);
  const queued = label === "Queued";
  const title = queued
    ? `Queued — ${wait ? waitSentence(wait) : "next in line"}`
    : `Factory · ${label}`;
  return (
    <span
      data-factory-stage={label}
      title={title}
      className={cn(
        "max-w-[8.5rem] shrink-0 truncate rounded px-1 text-[0.6875rem] leading-4",
        queued ? "bg-secondary text-muted-foreground" : "bg-primary/10 text-primary",
        receded && "opacity-50",
      )}
    >
      {label}
      <span className="sr-only">{queued ? ` — ${title}` : ""}</span>
    </span>
  );
}
