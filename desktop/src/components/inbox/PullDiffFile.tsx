import { ChevronDown, ChevronRight, Square, SquareCheck } from "lucide-react";
import * as React from "react";

import { countPatchStats, type PatchFileBlock, type PatchLine } from "@/lib/pullDiff";
import { highlightPatchBlock, type PatchHighlight } from "@/lib/pullDiffHighlight";
import { cn } from "@/lib/utils";

import { PullDiffLines, type CommentIntent, type LineRange } from "./PullDiffLines";

/** The diff's `leading-5` — what one rendered line is worth in the estimate. */
const ROW_HEIGHT_PX = 20;

/**
 * One file's changes: a header that stays put while you scroll it, and the
 * hunks under it. Syntax colouring is fetched per file and only once the file
 * is open, so a 40-file pull request parses what you actually read.
 */
export function PullDiffFile({
  block,
  mode,
  expanded,
  viewed,
  onToggleExpanded,
  onToggleViewed,
  onComment,
  lineExtras,
  range,
  registerAnchor,
}: {
  block: PatchFileBlock;
  mode: "unified" | "split";
  expanded: boolean;
  viewed: boolean;
  onToggleExpanded: () => void;
  onToggleViewed: () => void;
  onComment?: (line: PatchLine, intent: CommentIntent) => void;
  lineExtras?: (line: PatchLine) => React.ReactNode;
  /** The span a comment being written on this file covers. */
  range?: LineRange;
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

  React.useEffect(() => {
    if (!expanded || block.binary) return;
    let cancelled = false;
    void highlightPatchBlock(block).then((next) => {
      // An empty map means there was nothing to colour (no grammar for this
      // file, or past the budget). Not worth a re-render.
      if (!cancelled && next.size > 0) setTokens(next);
    });
    return () => {
      cancelled = true;
    };
  }, [block, expanded]);

  return (
    <div
      ref={(node) => registerAnchor?.(block.path, node)}
      className="rounded-md border border-border/70"
    >
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
          onClick={onToggleExpanded}
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
          onClick={onToggleViewed}
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
              <PullDiffLines
                key={hunk.id}
                hunk={hunk}
                mode={mode}
                tokens={tokens ?? undefined}
                onComment={onComment}
                lineExtras={lineExtras}
                range={range}
              />
            ))}
          </div>
        ))}
    </div>
  );
}
