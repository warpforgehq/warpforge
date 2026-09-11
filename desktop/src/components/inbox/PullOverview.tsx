import { Loader2 } from "lucide-react";

import { TrackerImage } from "@/components/backlog/TrackerImage";
import { PullActivity } from "@/components/inbox/PullActivity";
import { PullMetaRail, type PullReviewer } from "@/components/inbox/PullMetaRail";
import { Markdown } from "@/components/Markdown";
import { Panel, PanelGroup, PanelSeparator } from "@/components/ui/panels";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { inlineHtmlImages } from "@/lib/trackerMarkdown";
import type {
  PullRequestDetails,
  PullRequestFile,
  PullRequestSummary,
  PullThread,
} from "@/protocol";
import { PANEL_BOUNDS, usePanelSize } from "@/store/panelLayout";

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
  const isWide = useMediaQuery("(min-width: 1280px)");
  const [railSize, setRailSize] = usePanelSize("pullMeta");
  const railBounds = PANEL_BOUNDS.pullMeta;

  /*
   * Two panes that scroll separately from 1280px up: reading a long
   * description must not push the rail's status and file list off screen,
   * and scrolling 52 files must not move the conversation. Below that width
   * there is no room for a rail beside a readable measure, so it stacks
   * under the activity and the whole thing is one scroller again.
   */
  const document = (
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
        <PullActivity pr={pr} thread={thread} onPosted={onThreadChanged} onOpenDiff={onOpenDiff} />
      )}
    </div>
  );

  const metaRail = (
    <PullMetaRail
      pr={pr}
      details={details}
      reviewers={reviewers}
      files={files}
      onOpenFile={onOpenFile}
    />
  );

  if (!isWide) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="min-w-0 flex-1 px-4 py-4">{document}</div>
        <div className="shrink-0 px-4 pb-4">{metaRail}</div>
      </div>
    );
  }

  return (
    <PanelGroup orientation="horizontal" className="min-h-0 flex-1">
      <Panel pin className="min-w-0">
        <div className="h-full min-w-0 overflow-y-auto px-4 py-4">{document}</div>
      </Panel>
      <PanelSeparator aria-label="Resize pull request details panel" />
      <Panel
        size={railSize}
        minSize={railBounds.min}
        maxSize={railBounds.max}
        defaultSize={railBounds.default}
        onSizeChange={setRailSize}
        className="min-w-0"
      >
        <div className="flex h-full min-h-0 flex-col overflow-y-auto px-4 py-4">{metaRail}</div>
      </Panel>
    </PanelGroup>
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
