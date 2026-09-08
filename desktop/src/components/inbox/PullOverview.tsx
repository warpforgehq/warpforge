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
  onLoadFiles,
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
  onLoadFiles?: () => void;
  /** Takes a file from the rail to its diff. */
  onOpenFile?: (path: string) => void;
  onOpenDiff?: () => void;
  onThreadChanged: () => void;
}) {
  const body = (details?.body ?? "").trim();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Two columns from 1280px up: the pane already gives ~320px to the
          inbox list, so a viewport narrower than that has no room for a rail
          beside a readable measure — it stacks under the activity instead. */}
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-x-8 gap-y-6 px-4 py-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="flex min-w-0 flex-col gap-6">
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

        <PullMetaRail
          pr={pr}
          details={details}
          reviewers={reviewers}
          files={files}
          onOpenFile={onOpenFile}
          onLoadFiles={onLoadFiles}
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
