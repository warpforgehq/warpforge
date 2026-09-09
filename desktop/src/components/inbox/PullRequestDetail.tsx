import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Check,
  ChevronDown,
  FileDiff,
  Loader2,
  MessageSquareWarning,
  Send,
  SquareChartGantt,
} from "lucide-react";
import * as React from "react";

import { PullAssistantLive } from "@/components/inbox/PullAssistant";
import { AssistantThreadItem } from "@/components/inbox/PullAssistantControls";
import { PullDetailHeader } from "@/components/inbox/PullDetailHeader";
import { PullDiffView } from "@/components/inbox/PullDiffView";
import { PullOverview } from "@/components/inbox/PullOverview";
import { PullReviewComposer, type ReviewVerdict } from "@/components/inbox/PullReviewComposer";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SurfaceTabs, type SurfaceTab } from "@/components/workspace/SurfaceTabs";
import { daemon } from "@/daemon";
import {
  inboxTaskPrompt,
  unresolvedReviewComments,
  type InboxTaskIntent,
} from "@/lib/inboxTaskPrompt";
import type { CommitRange } from "@/lib/pullCommits";
import { cn } from "@/lib/utils";
import type { PullRequestSummary } from "@/protocol";

type DetailTab = "overview" | "diff" | "assistant";

const DETAIL_TABS: readonly SurfaceTab<DetailTab>[] = [
  { id: "overview", label: "Overview", icon: SquareChartGantt },
  { id: "diff", label: "Diff", icon: FileDiff },
  // The agent sits beside the code rather than inside it: asking about a
  // change and reading it are two different postures.
  { id: "assistant", label: "Assistant", icon: Bot },
];

/**
 * How long a pull request has to stay selected before its file list is
 * fetched. Walking the inbox with `j`/`k` must not pull a patch per row, and
 * a button asking for the list was two clicks to see what the rail is for.
 */
const FILE_LIST_DELAY_MS = 400;

/** Review states a reviewer line can carry; a dismissed review reads as "has
 *  spoken", not as a verdict, so it renders muted like a comment. */
const REVIEWER_STATES = new Set(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"]);

/**
 * One pull request's review: a three-row header, the Overview/Diff tabs, and
 * the actions that write to GitHub or leave the inbox.
 *
 * There used to be three tabs. "Conversation" is gone: review bodies belong
 * under the description on Overview, and inline threads belong on the lines
 * they were written about, which is Diff. Details and the conversation fetch
 * on open; the patch waits for the Diff tab unless the overview asks for the
 * file list.
 */
export function PullRequestDetail({
  pr,
  onSendToAgent,
  className,
}: {
  pr: PullRequestSummary;
  /** Fired by the "Send to agent" action with the PR and the composed
   *  prompt; the host owns task creation. */
  onSendToAgent?: (pr: PullRequestSummary, prompt: string) => void;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = React.useState<DetailTab>("overview");
  const [filesRequested, setFilesRequested] = React.useState(false);
  /** A file picked on the overview, for the diff to scroll to on arrival. */
  const [focusPath, setFocusPath] = React.useState<string | null>(null);
  /** Which commits the diff covers; null is the whole pull request. */
  const [range, setRange] = React.useState<CommitRange | null>(null);

  React.useEffect(() => {
    setFilesRequested(false);
    const timer = setTimeout(() => setFilesRequested(true), FILE_LIST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pr.project, pr.number]);

  const detailsQuery = useQuery({
    queryKey: ["pull", "details", pr.project, pr.number],
    queryFn: () => daemon.pullDetails(pr.project, pr.number),
    staleTime: 60_000,
    retry: false,
  });
  const threadQuery = useQuery({
    queryKey: ["pull", "thread", pr.project, pr.number],
    queryFn: () => daemon.pullThread(pr.project, pr.number),
    staleTime: 30_000,
    retry: false,
  });
  // The range is part of the key, so switching commits swaps to a cached
  // patch instead of refetching one already read — and switching back to
  // "all commits" is free.
  const diffQuery = useQuery({
    queryKey: ["pull", "diff", pr.project, pr.number, range?.fromOid ?? "", range?.toOid ?? ""],
    queryFn: () => daemon.pullDiff(pr.project, pr.number, range),
    enabled: tab === "diff",
    // Picking a commit keeps the patch already on screen until the narrowed
    // one arrives. Without it the key change empties the query, the surface
    // has nothing to render, and the toolbar the click came from unmounts —
    // taking the open commit picker with it.
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    retry: false,
  });
  /**
   * The whole change, for the overview's file list.
   *
   * Deliberately a second query rather than a read of `diffQuery`: a commit
   * range is a way to read the diff, not a filter on what the pull request
   * changes, so "13 files changed" must not become 4 because someone is
   * reading one commit. With no range set the two share a key, so this is one
   * fetch that also warms the Diff tab.
   */
  const filesQuery = useQuery({
    queryKey: ["pull", "diff", pr.project, pr.number, "", ""],
    queryFn: () => daemon.pullDiff(pr.project, pr.number, null),
    enabled: filesRequested || (tab === "diff" && !range),
    staleTime: 5 * 60_000,
    retry: false,
  });
  // Commits are only a Diff-tab affordance, and cheap enough to keep for the
  // session: the list only moves when the branch is pushed to, which bumps
  // `updatedAt` and invalidates this with everything else.
  const commitsQuery = useQuery({
    queryKey: ["pull", "commits", pr.project, pr.number],
    queryFn: () => daemon.pullCommits(pr.project, pr.number),
    enabled: tab === "diff",
    staleTime: 5 * 60_000,
    retry: false,
  });

  const details = detailsQuery.data ?? null;
  /**
   * What the review has left unanswered — the count on the "Address review
   * comments" action, and the reason it can be disabled: sending an agent to
   * fix nothing is how the old single button earned its reputation.
   */
  const unresolved = React.useMemo(
    () => unresolvedReviewComments(threadQuery.data ?? null),
    [threadQuery.data],
  );

  const refresh = React.useCallback(() => {
    for (const part of ["details", "thread", "diff", "commits"]) {
      void queryClient.invalidateQueries({
        queryKey: ["pull", part, pr.project, pr.number],
      });
    }
  }, [pr.number, pr.project, queryClient]);

  /**
   * Keep an open review current without a second poller.
   *
   * The listing (`useInboxPulls`, 30s, paused when the window is hidden) is
   * the only thing watching GitHub, and a new comment, review or push moves
   * the PR's `updatedAt`. So the listing's own poll is the change signal: when
   * the timestamp under an open review moves, its description, conversation
   * and patch are stale by definition. Nothing extra goes over the wire while
   * the PR sits still.
   *
   * The refresh action stays because not everything bumps the timestamp — a
   * resolved thread, for one.
   */
  const seenUpdatedAt = React.useRef(pr.updatedAt);
  React.useEffect(() => {
    if (seenUpdatedAt.current === pr.updatedAt) return;
    seenUpdatedAt.current = pr.updatedAt;
    refresh();
  }, [pr.updatedAt, refresh]);

  const refreshing =
    detailsQuery.isFetching ||
    threadQuery.isFetching ||
    diffQuery.isFetching ||
    commitsQuery.isFetching;

  /**
   * Who has said what so far, as one entry per reviewer: the latest review
   * state wins. The conversation already ships every review; only the rail
   * renders them, and "who is this waiting on" is half of what a review
   * surface exists to answer.
   */
  const reviewers = React.useMemo(() => {
    const byLogin = new Map<string, { login: string; state: string }>();
    for (const comment of threadQuery.data?.comments ?? []) {
      if (comment.kind !== "review" || !comment.author?.login || !comment.state) continue;
      if (!REVIEWER_STATES.has(comment.state)) continue;
      byLogin.set(comment.author.login, { login: comment.author.login, state: comment.state });
    }
    return [...byLogin.values()];
  }, [threadQuery.data]);

  /**
   * The review verdict being written, if any. A draft PR cannot receive one
   * (GitHub's own rule), so the actions sit disabled with a tooltip rather
   * than erroring after a typed summary.
   */
  const [verdict, setVerdict] = React.useState<ReviewVerdict | null>(null);

  const invalidateThread = React.useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["pull", "thread", pr.project, pr.number],
    });
  }, [pr.number, pr.project, queryClient]);

  const onVerdictSubmitted = React.useCallback(() => {
    setVerdict(null);
    // The decision chip and the conversation both change, and the listing
    // feeds the unread logic — all three go stale together.
    void queryClient.invalidateQueries({
      queryKey: ["pull", "details", pr.project, pr.number],
    });
    invalidateThread();
    void queryClient.invalidateQueries({ queryKey: ["inbox", "pulls"] });
  }, [invalidateThread, pr.number, pr.project, queryClient]);

  const sendToAgent = React.useCallback(
    (intent: InboxTaskIntent) => {
      onSendToAgent?.(
        pr,
        inboxTaskPrompt({
          details,
          files: filesQuery.data?.files ?? null,
          intent,
          pr,
          thread: threadQuery.data ?? null,
        }),
      );
    },
    [details, filesQuery.data, onSendToAgent, pr, threadQuery.data],
  );

  const openFile = React.useCallback((path: string) => {
    setFocusPath(path);
    setFilesRequested(true);
    setTab("diff");
  }, []);

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <PullDetailHeader pr={pr} details={details} refreshing={refreshing} onRefresh={refresh} />

      {/* Tabs left, review actions right: the verdict is what you do once,
          at the end, so it sits out of the reading path rather than shouting
          from the header. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-2">
        <SurfaceTabs
          aria-label="Pull request sections"
          value={tab}
          onValueChange={setTab}
          tabs={DETAIL_TABS}
        />
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-6 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground",
              verdict === "APPROVE" && "text-ok",
            )}
            disabled={pr.draft}
            title={
              pr.draft
                ? "Draft pull requests cannot receive a review verdict"
                : "Approve this pull request"
            }
            onClick={() => setVerdict("APPROVE")}
          >
            <Check className="size-3" />
            Approve
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-6 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground",
              verdict === "REQUEST_CHANGES" && "text-warn",
            )}
            disabled={pr.draft}
            title={
              pr.draft
                ? "Draft pull requests cannot receive a review verdict"
                : "Request changes on this pull request"
            }
            onClick={() => setVerdict("REQUEST_CHANGES")}
          >
            <MessageSquareWarning className="size-3" />
            Request changes
          </Button>
          {onSendToAgent && (
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={detailsQuery.isLoading}
                title="Start a task from this pull request"
                data-testid="inbox-send-to-agent"
                className="flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-foreground hover:bg-secondary disabled:text-muted-foreground/40"
              >
                {detailsQuery.isLoading ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : (
                  <Send className="size-3" aria-hidden />
                )}
                Send to agent
                <ChevronDown className="size-3" aria-hidden />
              </DropdownMenuTrigger>
              {/* Everything here ends up as a task on the board, and every
                  line says so: the complaint this answers was not five agent
                  buttons but not knowing which one leaves the pull request. */}
              <DropdownMenuPortal>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel className="py-1 text-xs font-normal text-muted-foreground">
                    Hand the work over
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    className="flex-col items-start gap-0.5 px-2 py-1.5"
                    disabled={unresolved.length === 0}
                    onSelect={() => sendToAgent("comments")}
                  >
                    <span className="text-sm">
                      Address review comments
                      {unresolved.length > 0 && (
                        <span className="tnum ml-1.5 text-muted-foreground">
                          {unresolved.length}
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {unresolved.length > 0
                        ? "Starts a task on this branch to fix them, commit and push"
                        : "Nothing unresolved on this pull request"}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="flex-col items-start gap-0.5 px-2 py-1.5"
                    onSelect={() => sendToAgent("branch")}
                  >
                    <span className="text-sm">Work on this branch</span>
                    <span className="text-[11px] text-muted-foreground">
                      Starts a task that picks the change up where it left off
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="py-1 text-xs font-normal text-muted-foreground">
                    Assistant
                  </DropdownMenuLabel>
                  <AssistantThreadItem pr={pr} />
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Directly under the action that opened it, so the summary reads as
          part of the verdict rather than as a new section of the page. */}
      {verdict && (
        <PullReviewComposer
          project={pr.project}
          number={pr.number}
          verdict={verdict}
          onClose={() => setVerdict(null)}
          onSubmitted={onVerdictSubmitted}
        />
      )}

      {tab === "assistant" ? (
        <PullAssistantLive pr={pr} details={details} />
      ) : tab === "diff" ? (
        // The Diff tab owns its own scrolling: its file rail and sticky file
        // headers have to sit still while the diff moves under them. It also
        // owns its own loading state — the toolbar there is what changes the
        // patch, so this must not swap the whole surface for a spinner.
        <div className="flex min-h-0 flex-1 flex-col">
          <PullDiffView
            pr={pr}
            diff={diffQuery.data ?? null}
            loading={diffQuery.isFetching}
            error={diffQuery.error}
            thread={threadQuery.data ?? null}
            focusPath={focusPath}
            commits={commitsQuery.data ?? []}
            commitsLoading={commitsQuery.isLoading}
            range={range}
            onRangeChange={setRange}
            onThreadChanged={invalidateThread}
          />
        </div>
      ) : (
        <PullOverview
          pr={pr}
          details={details}
          detailsLoading={detailsQuery.isLoading}
          detailsError={detailsQuery.error}
          thread={threadQuery.data ?? null}
          threadLoading={threadQuery.isLoading}
          threadError={threadQuery.error}
          reviewers={reviewers}
          files={filesQuery.data?.files ?? null}
          onOpenFile={openFile}
          onOpenDiff={() => setTab("diff")}
          onThreadChanged={invalidateThread}
        />
      )}
    </div>
  );
}
