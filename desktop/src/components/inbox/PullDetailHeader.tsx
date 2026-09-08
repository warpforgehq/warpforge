import { ArrowLeft, ExternalLink, GitBranch, RefreshCw } from "lucide-react";

import { ReviewDecisionGlyph } from "@/components/inbox/ReviewDecisionChip";
import { Button } from "@/components/ui/button";
import { openExternalLink } from "@/lib/externalLinks";
import { cn } from "@/lib/utils";
import type { PullRequestDetails, PullRequestSummary } from "@/protocol";

/**
 * Three quiet rows over a review: where this is, what it is called, and what
 * it does to the code.
 *
 * The header used to carry the verdict buttons, the decision chip, every
 * reviewer, the assignees and the branch route on one wrapping line, which
 * left the title fighting for attention with its own metadata. The rail on
 * the Overview tab owns the facts now; this keeps only what stays true on
 * every tab, and the review actions moved down to the tab bar.
 */
export function PullDetailHeader({
  pr,
  details,
  refreshing,
  onRefresh,
}: {
  pr: PullRequestSummary;
  details: PullRequestDetails | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const author = details?.author?.login || pr.author?.login;
  const state = (details?.state || pr.state).toLowerCase();
  const draft = details?.draft ?? pr.draft;

  return (
    <header className="flex shrink-0 flex-col gap-1 border-b border-border/70 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="shrink-0 capitalize text-foreground/70">{draft ? "Draft" : state}</span>
        <ReviewDecisionGlyph decision={pr.reviewDecision} />
        <span className="min-w-0 flex-1 truncate" title={`${pr.repo}#${pr.number}`}>
          {pr.repo && (
            <span className="tnum">
              {pr.repo}#{pr.number}
            </span>
          )}
          {pr.project !== pr.repo && (
            <>
              <Dot />
              <span>{pr.project}</span>
            </>
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Refresh this pull request"
          title="Refresh this pull request"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCw className={cn("size-3", refreshing && "animate-spin")} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Open on GitHub"
          title="Open on GitHub"
          onClick={() => void openExternalLink(pr.url)}
        >
          <ExternalLink className="size-3" />
        </Button>
      </div>

      {/* Two lines at most: a long title that wrapped freely pushed the diff
          off the first screen, and one truncated to a single line lost the
          part that says what the change actually does. */}
      <h2 className="line-clamp-2 text-base font-semibold leading-snug tracking-tight text-foreground">
        {details?.title || pr.title}
      </h2>

      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {author && <span className="shrink-0">{author}</span>}
        <BranchRoute
          head={details?.headRefName || pr.headRefName}
          base={details?.baseRefName || pr.baseRefName}
        />
        {details && (
          <span className="tnum inline-flex items-center gap-1.5">
            <span className="text-ok">+{details.additions}</span>
            <span className="text-destructive">−{details.deletions}</span>
            <span>
              {details.changedFiles} {details.changedFiles === 1 ? "file" : "files"}
            </span>
          </span>
        )}
      </div>
    </header>
  );
}

function Dot() {
  return (
    <span aria-hidden className="px-1.5 text-border">
      ·
    </span>
  );
}

/** One branch as plain mono text — the boxed chips at 11px had neither the
 *  contrast nor the room to be readable, so the shape carries the meaning:
 *  the head is bright, the base is muted, the arrow points the way. */
function BranchChip({ name, base }: { name: string; base?: boolean }) {
  return (
    <span
      title={name}
      className={cn(
        "inline-flex min-w-0 max-w-64 items-center gap-1.5 font-mono text-xs",
        base ? "text-muted-foreground" : "text-foreground",
      )}
    >
      <GitBranch
        aria-hidden
        className={cn("size-3.5 shrink-0", base ? "text-muted-foreground" : "text-primary")}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Base first, head second: the merge reads right-to-left because that is the
 *  direction the code travels, and the target branch is what a reviewer
 *  checks first. */
function BranchRoute({ head, base }: { head: string; base: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={`${head} → ${base}`}>
      <BranchChip name={base} base />
      <ArrowLeft aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
      <BranchChip name={head} />
    </span>
  );
}
