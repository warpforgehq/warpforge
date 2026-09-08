import { ChevronDown, ChevronRight, Square, SquareCheck } from "lucide-react";
import * as React from "react";

import { canObserveViewport, observeNearViewport } from "@/lib/nearViewport";
import { countPatchStats, linesInRange, type PatchFileBlock, type PatchLine } from "@/lib/pullDiff";
import { highlightPatchBlock, type PatchHighlight } from "@/lib/pullDiffHighlight";
import { cn } from "@/lib/utils";
import type { PullComment } from "@/protocol";

import { PullDiffHunk, ROW_HEIGHT_PX } from "./PullDiffHunk";
import { lineNumberFor, lineSide, type CommentIntent } from "./PullDiffLines";
import { PullLineComments } from "./PullLineComments";

/** The comment being written, when it is being written on *this* file. */
export interface FileDraft {
  side: "LEFT" | "RIGHT";
  start: number;
  end: number;
  pending: boolean;
}

/**
 * One file's changes: a header that stays put while you scroll it, and the
 * hunks under it. Syntax colouring is fetched per file and only once the file
 * is open, so a 40-file pull request parses what you actually read.
 */
export const PullDiffFile = React.memo(function PullDiffFile({
  block,
  mode,
  expanded,
  viewed,
  project,
  number,
  threads,
  draft,
  onToggleExpanded,
  onToggleViewed,
  onComment,
  onCompose,
  onCancelDraft,
  onPosted,
  registerAnchor,
}: {
  block: PatchFileBlock;
  mode: "unified" | "split";
  expanded: boolean;
  viewed: boolean;
  project: string;
  number: number;
  /** Review threads on this file, by post-image line. */
  threads?: ReadonlyMap<number, PullComment[]>;
  /** Set only while the comment being written belongs to this file, so a drag
   *  re-renders one file instead of all of them. */
  draft?: FileDraft;
  onToggleExpanded: (path: string) => void;
  onToggleViewed: (path: string) => void;
  onComment: (path: string, line: PatchLine, intent: CommentIntent) => void;
  onCompose: (path: string, line: number, side: "LEFT" | "RIGHT") => void;
  onCancelDraft: () => void;
  onPosted: () => void;
  /** Lets the file rail scroll this block into view. */
  registerAnchor?: (path: string, node: HTMLDivElement | null) => void;
}) {
  const [tokens, setTokens] = React.useState<PatchHighlight | null>(null);
  const stats = React.useMemo(() => countPatchStats([block]), [block]);

  /**
   * Off-screen hunks cost nothing to paint: `content-visibility: auto` lets
   * the browser skip the whole subtree until it scrolls near, which is what
   * keeps a 50-file / several-thousand-line diff scrolling smoothly. The
   * estimate keeps the scrollbar honest — without it every skipped block
   * collapses to zero and the page height thrashes while you scroll.
   */
  const lineCount = React.useMemo(
    () => block.hunks.reduce((count, hunk) => count + hunk.lines.length, 0),
    [block],
  );
  // A split row carries two lines, so the rendered row count halves.
  const estimatedHeight = (mode === "split" ? Math.ceil(lineCount / 2) : lineCount) * ROW_HEIGHT_PX;
  const pinned = !!draft || (threads?.size ?? 0) > 0;

  const path = block.path;

  /**
   * Colouring is charged per file the reviewer scrolls to, not per file in the
   * pull request: it is synchronous CodeMirror work, and 60 files starting at
   * once blocked the main thread for a third of a second before anything could
   * be hovered.
   */
  const container = React.useRef<HTMLDivElement | null>(null);
  const [near, setNear] = React.useState(!canObserveViewport());
  // The ref, not a state node: setting state from the ref callback re-rendered
  // every file once more at mount, and with it every one of its rows.
  React.useEffect(() => {
    const node = container.current;
    if (!node) return;
    return observeNearViewport(node, setNear);
  }, []);

  const comment = React.useCallback(
    (line: PatchLine, intent: CommentIntent) => onComment(path, line, intent),
    [onComment, path],
  );
  const toggleExpanded = React.useCallback(() => onToggleExpanded(path), [onToggleExpanded, path]);
  const toggleViewed = React.useCallback(() => onToggleViewed(path), [onToggleViewed, path]);

  /**
   * The threads and the composer that hang under a line. Built here rather
   * than handed down as a closure from the view: a per-file closure changed
   * identity on every parent render, which re-rendered every file's rows.
   */
  const lineExtras = React.useCallback(
    (line: PatchLine) => {
      const lineNumber = lineNumberFor(line);
      if (lineNumber === undefined) return null;
      const side = lineSide(line);
      const comments = side === "RIGHT" ? (threads?.get(lineNumber) ?? []) : [];
      // The composer hangs off the range's last line — where the eye already
      // is after a shift-click.
      const composing =
        !!draft && !draft.pending && draft.side === side && draft.end === lineNumber;
      if (comments.length === 0 && !composing) return null;
      const span = composing && draft ? draft : null;
      return (
        <PullLineComments
          project={project}
          number={number}
          path={path}
          line={lineNumber}
          startLine={span && span.start !== span.end ? span.start : undefined}
          side={side}
          comments={comments}
          composing={composing}
          suggestionSeed={span ? linesInRange(block, side, span.start, span.end) : []}
          onCompose={() => onCompose(path, lineNumber, side)}
          onCancel={onCancelDraft}
          onPosted={onPosted}
        />
      );
    },
    [block, draft, number, onCancelDraft, onCompose, onPosted, path, project, threads],
  );

  React.useEffect(() => {
    if (!expanded || !near || block.binary) return;
    let cancelled = false;
    void highlightPatchBlock(block).then((next) => {
      // An empty map means there was nothing to colour (no grammar for this
      // file, or past the budget). Not worth a re-render.
      if (!cancelled && next.size > 0) setTokens(next);
    });
    return () => {
      cancelled = true;
    };
  }, [block, expanded, near]);

  const attach = React.useCallback(
    (next: HTMLDivElement | null) => {
      registerAnchor?.(path, next);
      container.current = next;
    },
    [path, registerAnchor],
  );

  return (
    <div ref={attach} className="rounded-md border border-border/70">
      <div
        className={cn(
          // Opaque, not `bg-secondary/60` + `backdrop-blur-sm`: a blur layer
          // per sticky header is what made a 50-file diff stutter on scroll —
          // the compositor re-blurred 52 elements every frame.
          "sticky top-0 z-10 flex h-9 items-center gap-2 rounded-t-md border-b border-border/70 bg-secondary px-2",
          viewed && "opacity-60",
        )}
      >
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {expanded ? (
            <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 truncate font-mono text-xs text-foreground/80">
            {block.oldPath && block.oldPath !== block.path
              ? `${block.oldPath} → ${block.path}`
              : block.path || "unknown file"}
          </span>
        </button>
        <span className="tnum flex shrink-0 items-center gap-2 text-xs">
          {stats.additions > 0 && <span className="text-ok">+{stats.additions}</span>}
          {stats.deletions > 0 && <span className="text-destructive">−{stats.deletions}</span>}
        </span>
        <button
          type="button"
          onClick={toggleViewed}
          aria-pressed={viewed}
          title={viewed ? "Mark as not viewed" : "Mark as viewed"}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs",
            viewed
              ? "bg-ok/15 text-ok"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          {viewed ? <SquareCheck className="size-3.5" /> : <Square className="size-3.5" />}
          Viewed
        </button>
      </div>

      {expanded &&
        (block.binary ? (
          <p className="px-2.5 py-2 text-xs text-muted-foreground/60">Binary file not shown.</p>
        ) : block.hunks.length === 0 ? (
          <p className="px-2.5 py-2 text-xs text-muted-foreground/60">
            No textual diff for this file.
          </p>
        ) : (
          <div
            className="py-1 font-mono leading-5"
            style={{
              fontSize: "var(--app-mono-font-size)",
              contentVisibility: "auto",
              containIntrinsicSize: `auto ${estimatedHeight}px`,
            }}
          >
            {block.hunks.map((hunk) => (
              <PullDiffHunk
                key={hunk.id}
                hunk={hunk}
                mode={mode}
                tokens={tokens ?? undefined}
                onComment={comment}
                lineExtras={lineExtras}
                range={draft ? { end: draft.end, side: draft.side, start: draft.start } : undefined}
                // A composer and a reply box keep their typed text in the DOM
                // they render into, so a file carrying either stays mounted
                // however far it scrolls away.
                pinned={pinned}
              />
            ))}
          </div>
        ))}
    </div>
  );
});
