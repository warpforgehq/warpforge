import {
  ChevronDown,
  ExternalLink,
  GitBranch,
  Hash,
  Link2,
  RefreshCw,
  TextQuote,
} from "lucide-react";

import { AuthorBadge } from "@/components/inbox/AuthorBadge";
import { ReviewDecisionGlyph } from "@/components/inbox/ReviewDecisionChip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyText } from "@/lib/clipboard";
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
  const title = details?.title || pr.title;
  const branch = details?.headRefName || pr.headRefName;

  return (
    <header className="flex shrink-0 flex-col gap-0.5 border-b border-rule px-3 py-2">
      <div className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
        {/* The reference is the menu, the way Linear does it: everything you
            would want to do with this pull request hangs off its own name.
            The state word that sat beside it is gone — the list glyph and the
            Overview rail both say it, and a header repeats neither. */}
        <RefMenu pr={pr} title={title} branch={branch} />
        <ReviewDecisionGlyph decision={pr.reviewDecision} />
        {author && (
          <span className="flex min-w-0 items-center gap-1.5" title={`Author: ${author}`}>
            <AuthorBadge login={author} size={4} />
            <span className="min-w-0 truncate text-foreground/80">{author}</span>
          </span>
        )}
        <span className="flex-1" />
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
      </div>

      {/* Two lines at most: a long title that wrapped freely pushed the diff
          off the first screen, and one truncated to a single line lost the
          part that says what the change actually does. */}
      <h2 className="line-clamp-2 text-base font-semibold leading-snug tracking-tight text-foreground">
        {title}
      </h2>
    </header>
  );
}

/** The `repo#number` badge as a menu of everything useful to do with it. */
function RefMenu({ pr, title, branch }: { pr: PullRequestSummary; title: string; branch: string }) {
  const ref = `${pr.repo}#${pr.number}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Pull request actions"
          className="tnum -mx-1 flex shrink-0 items-center gap-0.5 rounded px-1 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground data-[state=open]:bg-secondary/60 data-[state=open]:text-foreground"
        >
          {ref}
          <ChevronDown aria-hidden className="size-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => void openExternalLink(pr.url)}>
            <ExternalLink aria-hidden />
            Open in GitHub
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyText(pr.url, "GitHub URL")}>
            <Link2 aria-hidden />
            Copy GitHub URL
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!branch}
            onSelect={() => void copyText(branch, "branch name")}
          >
            <GitBranch aria-hidden />
            Copy branch name
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyText(`#${pr.number}`, "pull request number")}>
            <Hash aria-hidden />
            Copy pull request number
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void copyText(`[${title}](${pr.url})`, "title as link")}
          >
            <TextQuote aria-hidden />
            Copy title as link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}
