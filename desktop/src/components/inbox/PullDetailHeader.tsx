import { ExternalLink, RefreshCw } from "lucide-react";

import { ReviewDecisionGlyph } from "@/components/inbox/ReviewDecisionChip";
import { Button } from "@/components/ui/button";
import { openExternalLink } from "@/lib/externalLinks";
import { cn } from "@/lib/utils";
import type { PullRequestDetails, PullRequestSummary } from "@/protocol";

/**
 * Two rows: where this is, and what it is called. The branch route and the
 * diff size used to sit here too — the Overview rail states both, and a
 * header that repeats the rail is a header that reads twice.
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
    <header className="flex shrink-0 flex-col gap-0.5 border-b border-border/70 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="shrink-0 capitalize text-foreground/70">{draft ? "Draft" : state}</span>
        <ReviewDecisionGlyph decision={pr.reviewDecision} />
        <span className="min-w-0 flex-1 truncate" title={`${pr.repo}#${pr.number}`}>
          {pr.repo && (
            <span className="tnum">
              {pr.repo}#{pr.number}
            </span>
          )}
          {author && (
            <>
              <Dot />
              <span>{author}</span>
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
      <h2 className="line-clamp-2 text-sm font-semibold leading-snug tracking-tight text-foreground">
        {details?.title || pr.title}
      </h2>
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
