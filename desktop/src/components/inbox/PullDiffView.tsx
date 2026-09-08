import { Loader2 } from "lucide-react";
import * as React from "react";

import { usePullLineDraft } from "@/hooks/usePullLineDraft";
import type { CommitRange } from "@/lib/pullCommits";
import { parseUnifiedPatch } from "@/lib/pullDiff";
import {
  fingerprintPatchFile,
  pullViewedKey,
  setPullFileViewed,
  subscribePullViewed,
  viewedPathsSnapshot,
} from "@/lib/pullViewed";
import { isTypingTarget } from "@/lib/typingTarget";
import { cn } from "@/lib/utils";
import type {
  PullComment,
  PullCommit,
  PullRequestDiff,
  PullRequestSummary,
  PullThread,
} from "@/protocol";
import { useUi } from "@/store/ui";

import { PullDiffFile } from "./PullDiffFile";
import { PullDiffToolbar } from "./PullDiffToolbar";
import { PullFilesRail } from "./PullFilesRail";

/**
 * A pull request's changes, as a review surface: the changed-file rail, the
 * unified/split switch, per-file viewed marks, and the review threads sitting
 * on the lines they were written about.
 *
 * Everything renders from the raw unified patch the daemon already sent — the
 * split view is a pairing of those lines, not a second fetch of both file
 * revisions (ADR-0010). `[` and `]` walk the files.
 */
export function PullDiffView({
  pr,
  diff,
  loading,
  error,
  thread,
  focusPath,
  commits,
  commitsLoading,
  range,
  onRangeChange,
  onThreadChanged,
}: {
  pr: PullRequestSummary;
  /** The patch to render; null until the first one lands. */
  diff: PullRequestDiff | null;
  /** A patch is on the wire. The toolbar stays put and the body dims — a
   *  commit picked from that toolbar must not unmount the toolbar. */
  loading?: boolean;
  error?: Error | null;
  thread: PullThread | null;
  /** A file the host wants opened — what the overview's file list picks. */
  focusPath?: string | null;
  /** The pull request's commits, for the toolbar's picker. */
  commits: readonly PullCommit[];
  commitsLoading?: boolean;
  /** Which commits `diff` covers; null is the whole pull request. */
  range: CommitRange | null;
  onRangeChange: (range: CommitRange | null) => void;
  /** Fired after a comment posts, so the host can refetch the conversation. */
  onThreadChanged: () => void;
}) {
  const mode = useUi((s) => s.diffView);
  const setMode = useUi((s) => s.setDiffView);
  // Re-pairing every row of a 10k-line diff is real work. Off the urgent
  // path it stops swallowing the click that asked for it; the body dims the
  // same way it does while a narrowed patch loads.
  const [swapping, startSwap] = React.useTransition();
  const changeMode = React.useCallback(
    (next: "unified" | "split") => startSwap(() => setMode(next)),
    [setMode],
  );
  const railCollapsed = useUi((s) => s.pullFilesPanelCollapsed);
  const toggleRail = useUi((s) => s.togglePullFilesPanelCollapsed);

  const blocks = React.useMemo(() => (diff ? parseUnifiedPatch(diff.patch) : []), [diff]);

  const prKey = pullViewedKey(pr);
  // One fingerprint per file, so a viewed mark can be checked against the
  // version of the file it was made against rather than just its path.
  const fingerprints = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const block of blocks) map.set(block.path, fingerprintPatchFile(block));
    return map;
  }, [blocks]);
  const viewed = React.useSyncExternalStore(subscribePullViewed, () =>
    viewedPathsSnapshot(prKey, fingerprints),
  );
  // Read by the fold toggle, which must not change identity when a mark does.
  const viewedRef = React.useRef(viewed);
  viewedRef.current = viewed;

  /**
   * Folded state the reviewer chose by hand, overriding the default. The
   * default is "folded iff viewed" — every file starts open because a fresh
   * PR has no marks, and a file whose mark expired (its fingerprint moved on)
   * reopens open too. Deriving the default at every render instead of seeding
   * `collapsed` once at mount is what keeps the two from drifting apart: a
   * mount-time snapshot of `viewed` went stale the moment the mark did,
   * which is what re-created "pre-ticked and pre-folded" on a reopen.
   *
   * Ticking "Viewed" clears the override so the file falls back to the
   * derived default — now folded, since it is viewed — and unticking clears
   * it the same way, so the file falls back open. A manual fold via the
   * chevron is independent of viewed and survives until toggled again or the
   * component remounts.
   */
  const [foldOverride, setFoldOverride] = React.useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const isExpanded = React.useCallback(
    (path: string) => foldOverride.get(path) ?? !viewed.has(path),
    [foldOverride, viewed],
  );
  const toggleExpanded = React.useCallback(
    (path: string) =>
      setFoldOverride((current) => {
        const wasOpen = current.get(path) ?? !viewedRef.current.has(path);
        return new Map(current).set(path, !wasOpen);
      }),
    [],
  );

  /**
   * The one way a file's viewed mark moves, so the file header and the rail
   * cannot disagree about what ticking one means. The rail's tick used to be
   * a bare glyph with no handler at all: it rendered the state and swallowed
   * the click into "scroll to this file".
   */
  const toggleViewed = React.useCallback(
    (path: string) => {
      const next = !viewed.has(path);
      setPullFileViewed(prKey, path, fingerprints.get(path) ?? "", next);
      // Falling back to the derived default folds a freshly viewed file and
      // reopens a freshly unticked one; any manual fold the reviewer chose
      // for this file no longer applies once its viewed state changes.
      setFoldOverride((current) => {
        if (!current.has(path)) return current;
        const cleared = new Map(current);
        cleared.delete(path);
        return cleared;
      });
    },
    [fingerprints, prKey, viewed],
  );
  const [activePath, setActivePath] = React.useState<string | null>(blocks[0]?.path ?? null);
  const { draft, onComment, setDraft } = usePullLineDraft();

  const anchors = React.useRef(new Map<string, HTMLDivElement>());
  const registerAnchor = React.useCallback((path: string, node: HTMLDivElement | null) => {
    if (node) anchors.current.set(path, node);
    else anchors.current.delete(path);
  }, []);

  const jumpTo = React.useCallback(
    (path: string) => {
      setActivePath(path);
      const node = anchors.current.get(path);
      if (!node) return;
      if (!isExpanded(path)) {
        setFoldOverride((current) => new Map(current).set(path, true));
      }
      node.scrollIntoView({ block: "start" });
      // Hunks render lazily (content-visibility), so the file's position is
      // still sitting on an estimated height; settle once the real one lands.
      requestAnimationFrame(() => node.scrollIntoView({ block: "start" }));
    },
    [isExpanded],
  );

  /**
   * A file the host asked for, once. Keyed on the path rather than run on
   * every `jumpTo` identity change: `jumpTo` is rebuilt whenever a fold
   * changes, and re-jumping on that would drag the pane back to the overview's
   * pick every time the reviewer folded something else.
   */
  const focused = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!focusPath || focused.current === focusPath) return;
    focused.current = focusPath;
    jumpTo(focusPath);
  }, [focusPath, jumpTo]);

  // `[` / `]` step through the files, the same bracket pair the TUI uses to
  // walk service logs.
  React.useEffect(() => {
    if (blocks.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const step = event.key === "]" ? 1 : event.key === "[" ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      const current = blocks.findIndex((block) => block.path === activePath);
      const next = blocks[Math.min(blocks.length - 1, Math.max(0, current + step))];
      if (next) jumpTo(next.path);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePath, blocks, jumpTo]);

  /**
   * Inline review threads, per file and then per post-image line. GitHub's
   * wire shape carries a path and a line but not the side, so these anchor to
   * the post-image line; a thread on a deleted line stays readable in
   * Overview's Activity. Indexed per file so a row can look itself up without
   * a composite key built per line per render.
   */
  const threadsByPath = React.useMemo(() => {
    const index = new Map<string, Map<number, PullComment[]>>();
    for (const comment of thread?.comments ?? []) {
      if (comment.kind !== "review_comment" || !comment.path || !comment.line) continue;
      const perFile = index.get(comment.path) ?? new Map<number, PullComment[]>();
      perFile.set(comment.line, [...(perFile.get(comment.line) ?? []), comment]);
      index.set(comment.path, perFile);
    }
    return index;
  }, [thread]);

  const compose = React.useCallback(
    (path: string, line: number, side: "LEFT" | "RIGHT") =>
      setDraft({ anchor: line, end: line, path, pending: false, side, start: line }),
    [setDraft],
  );
  const cancelDraft = React.useCallback(() => setDraft(null), [setDraft]);
  const onPosted = React.useCallback(() => {
    setDraft(null);
    onThreadChanged();
  }, [onThreadChanged, setDraft]);

  return (
    <div className="flex h-full min-h-0 min-w-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PullDiffToolbar
          files={blocks.length}
          viewed={viewed.size}
          truncated={diff?.truncated ?? false}
          railOpen={!railCollapsed}
          onToggleRail={toggleRail}
          mode={mode}
          onModeChange={changeMode}
          commits={commits}
          commitsLoading={commitsLoading}
          range={range}
          onRangeChange={onRangeChange}
        />

        {/* The padding lives on the inner column, not the scroller: a sticky
            header stops at its scroll container's padding edge, which left
            each file's header floating below the top while it was pinned. */}
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          aria-busy={loading || swapping || undefined}
          data-testid="pull-diff-body"
        >
          {error ? (
            <p className="px-4 py-3 text-sm text-destructive">
              Could not load the diff: {error.message}
            </p>
          ) : blocks.length === 0 ? (
            loading ? (
              <Spinner label="Loading changes…" />
            ) : (
              <p className="px-4 py-6 text-sm text-muted-foreground/60">No file changes.</p>
            )
          ) : (
            <div
              className={cn(
                "flex flex-col gap-3 p-3 transition-opacity",
                // The previous patch stays legible while the next one arrives:
                // a spinner in its place is what made picking a commit feel
                // like leaving the page.
                (loading || swapping) && "opacity-50",
              )}
            >
              {/* Every prop here is stable or `undefined` for the files a
                  change does not touch: ticking one file off, folding one, or
                  dragging a comment span re-renders that file alone. */}
              {blocks.map((block) => (
                <PullDiffFile
                  key={block.path || block.hunks[0]?.id}
                  block={block}
                  mode={mode}
                  expanded={isExpanded(block.path)}
                  viewed={viewed.has(block.path)}
                  project={pr.project}
                  number={pr.number}
                  threads={threadsByPath.get(block.path)}
                  draft={draft?.path === block.path ? draft : undefined}
                  registerAnchor={registerAnchor}
                  onToggleExpanded={toggleExpanded}
                  onToggleViewed={toggleViewed}
                  onComment={onComment}
                  onCompose={compose}
                  onCancelDraft={cancelDraft}
                  onPosted={onPosted}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      {/* The changed-file rail sits on the right edge: with the app sidebar
          and the inbox list both on the left, a third left rail made three
          stacked columns of navigation before any content. */}
      {!railCollapsed && blocks.length > 0 && (
        <div className="w-64 shrink-0 border-l border-border/70">
          <PullFilesRail
            blocks={blocks}
            viewed={viewed}
            activePath={activePath}
            onSelect={jumpTo}
            onToggleViewed={toggleViewed}
          />
        </div>
      )}
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
