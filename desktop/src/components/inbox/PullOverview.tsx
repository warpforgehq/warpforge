import { Loader2 } from "lucide-react";

import { TrackerImage } from "@/components/backlog/TrackerImage";
import { PullActivity } from "@/components/inbox/PullActivity";
import { PullMetaRail, type PullReviewer } from "@/components/inbox/PullMetaRail";
import { Markdown } from "@/components/Markdown";
import { inlineHtmlImages } from "@/lib/trackerMarkdown";
import type {
  PullRequestDetails,
  PullRequestFile,
  PullRequestSummary,
  PullThread,
} from "@/protocol";

/**
 * The pull request as a document: what it says on the left, what it is on the
 * right.
 *
 * This replaced a "Summary" tab that was a wall of description text and a
 * "Conversation" tab nobody found: the reviews are the description's
 * counterpart and belong under it, while the countable facts belong in a rail
 * you consult rather than read. Inline threads stay on the Diff tab, where
 * the code they talk about is.
 */
export function PullOverview({
  pr,
  details,
  detailsLoading,
  detailsError,
  thread,
  threadLoading,
  threadError,
  reviewers,
  files,
  onOpenFile,
  onOpenDiff,
  onThreadChanged,
}: {
  pr: PullRequestSummary;
  details: PullRequestDetails | null;
  detailsLoading: boolean;
  detailsError?: Error | null;
  thread: PullThread | null;
  threadLoading: boolean;
  threadError?: Error | null;
  reviewers: readonly PullReviewer[];
  files: readonly PullRequestFile[] | null;
  /** Takes a file from the rail to its diff. */
  onOpenFile?: (path: string) => void;
  onOpenDiff?: () => void;
  onThreadChanged: () => void;
}) {
  const body = (details?.body ?? "").trim();

  return (
    /*
     * Two panes that scroll separately from 1280px up: reading a long
     * description must not push the rail's status and file list off screen,
     * and scrolling 52 files must not move the conversation. Below that width
     * there is no room for a rail beside a readable measure, so it stacks
     * under the activity and the whole thing is one scroller again — which is
     * why the overflow rules are all `xl:`.
     */
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden">
      <div className="min-w-0 flex-1 px-4 py-4 xl:overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-6">
          <section className="flex min-w-0 flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">Description</h3>
            {detailsLoading && !details ? (
              <Spinner label="Loading description…" />
            ) : detailsError ? (
              <p className="text-sm text-destructive">
                Could not load the pull request: {detailsError.message}
              </p>
            ) : body ? (
              <div className="max-w-[80ch]">
                <Markdown
                  density="comfortable"
                  renderImage={TrackerImage}
                  allowHtml
                  className="text-foreground/90"
                >
                  {inlineHtmlImages(body)}
                </Markdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/60">No description.</p>
            )}
          </section>

          {threadError ? (
            <p className="text-sm text-destructive">
              Could not load the conversation: {threadError.message}
            </p>
          ) : threadLoading && !thread ? (
            <Spinner label="Loading activity…" />
          ) : (
            <PullActivity
              pr={pr}
              thread={thread}
              onPosted={onThreadChanged}
              onOpenDiff={onOpenDiff}
            />
          )}
        </div>
      </div>

      <div className="shrink-0 px-4 pb-4 xl:flex xl:w-72 xl:min-h-0 xl:flex-col xl:border-l xl:border-border/70 xl:px-4 xl:py-4">
        <PullMetaRail
          pr={pr}
          details={details}
          reviewers={reviewers}
          files={files}
          onOpenFile={onOpenFile}
        />
      </div>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
