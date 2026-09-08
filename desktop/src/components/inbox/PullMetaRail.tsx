import { CircleDot, GitBranch, GitPullRequest, GitPullRequestClosed } from "lucide-react";
import * as React from "react";

import { AuthorBadge } from "@/components/inbox/AuthorBadge";
import { PullFilesChanged } from "@/components/inbox/PullFilesChanged";
import { REVIEW_DECISION_META } from "@/components/inbox/ReviewDecisionChip";
import { cn } from "@/lib/utils";
import type { PullRequestDetails, PullRequestFile, PullRequestSummary } from "@/protocol";

/** One reviewer and the last thing they said. */
export interface PullReviewer {
  login: string;
  state: string;
}

/**
 * Everything about a pull request that is not its description: state,
 * reviewers, branch, checks, and what it changes.
 *
 * It is a rail rather than a header strip because these are facts you consult
 * while reading, not once before you start — and because the header had grown
 * into three rows of chips competing with the title.
 */
export function PullMetaRail({
  pr,
  details,
  reviewers,
  files,
  onOpenFile,
}: {
  pr: PullRequestSummary;
  details: PullRequestDetails | null;
  reviewers: readonly PullReviewer[];
  files: readonly PullRequestFile[] | null;
  onOpenFile?: (path: string) => void;
}) {
  const state = (details?.state || pr.state).toLowerCase();
  const draft = details?.draft ?? pr.draft;

  return (
    /* The meta sections keep their place; only the file list scrolls, so a
       52-file change cannot push Status and Reviewers out of sight. */
    <aside className="flex w-full min-w-0 flex-col gap-5 xl:min-h-0">
      <Section title="Status">
        <StateLine state={state} draft={draft} />
      </Section>

      <Section title="Reviewers">
        {reviewers.length === 0 ? (
          <p className="text-xs text-muted-foreground/60">No reviews yet.</p>
        ) : (
          reviewers.map((reviewer) => <ReviewerLine key={reviewer.login} reviewer={reviewer} />)
        )}
      </Section>

      <Section title="Checks">
        {/* Deliberately empty rather than optimistic: nothing on the wire
            carries a check run yet (ADR-0010, deferred), and a green tick
            this surface invented is worse than no tick at all. */}
        <p className="text-xs text-muted-foreground/60" title="Planned — see docs/adr/0010">
          Status checks aren't read yet.
        </p>
      </Section>

      <Section title="Branch">
        <div className="flex min-w-0 flex-col gap-1 font-mono text-xs">
          <span
            className="flex min-w-0 items-center gap-1.5"
            title={details?.headRefName || pr.headRefName}
          >
            <GitBranch aria-hidden className="size-3 shrink-0 text-primary" />
            <span className="min-w-0 break-all text-foreground/90">
              {details?.headRefName || pr.headRefName}
            </span>
          </span>
          <span
            className="flex min-w-0 items-center gap-1.5 text-muted-foreground"
            title={`into ${details?.baseRefName || pr.baseRefName}`}
          >
            <GitBranch aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
            <span className="min-w-0 break-all">into {details?.baseRefName || pr.baseRefName}</span>
          </span>
        </div>
      </Section>

      {pr.labels.length > 0 && (
        <Section title="Labels">
          <div className="flex flex-wrap gap-1">
            {pr.labels.map((label) => (
              <span
                key={label.name}
                className="rounded border px-1.5 py-px text-[11px]"
                style={
                  label.color
                    ? {
                        borderColor: `#${label.color}66`,
                        color: `#${label.color}`,
                      }
                    : undefined
                }
              >
                {label.name}
              </span>
            ))}
          </div>
        </Section>
      )}

      {pr.assignees.length > 0 && (
        <Section title="Assignees">
          {pr.assignees.map((login) => (
            <span key={login} className="flex items-center gap-1.5 text-xs text-foreground/85">
              <AuthorBadge login={login} size={4} />
              {login}
            </span>
          ))}
        </Section>
      )}

      <PullFilesChanged
        files={files}
        changedFiles={details?.changedFiles ?? pr.changedFiles ?? 0}
        onOpenFile={onOpenFile}
      />
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <h4 className="text-xs text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

/** The pull request's own state. Merged and closed read the same on the wire
 *  (no `mergedAt` travels yet), so this says "Closed" for both rather than
 *  claiming a merge that may not have happened. */
function StateLine({ state, draft }: { state: string; draft: boolean }) {
  const closed = state === "closed" || state === "merged";
  const Icon = closed ? GitPullRequestClosed : draft ? CircleDot : GitPullRequest;
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-sm",
        closed ? "text-muted-foreground" : draft ? "text-muted-foreground" : "text-ok",
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {closed ? "Closed" : draft ? "Draft" : "Open"}
    </span>
  );
}

const REVIEWER_FALLBACK = {
  glyphClassName: "text-muted-foreground",
  icon: CircleDot,
  label: "Reviewed",
};

function ReviewerLine({ reviewer }: { reviewer: PullReviewer }) {
  const meta = REVIEW_DECISION_META[reviewer.state] ?? REVIEWER_FALLBACK;
  const Icon = meta.icon;
  return (
    <span
      className="flex min-w-0 items-center gap-1.5 text-xs"
      title={`${reviewer.login} — ${meta.label.toLowerCase()}`}
    >
      <AuthorBadge login={reviewer.login} size={4} />
      <span className="min-w-0 flex-1 truncate text-foreground/85">{reviewer.login}</span>
      <Icon aria-label={meta.label} className={cn("size-3.5 shrink-0", meta.glyphClassName)} />
    </span>
  );
}
