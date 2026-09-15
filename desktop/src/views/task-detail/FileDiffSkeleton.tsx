import { SkeletonBar, SKELETON_LINE_BAR_PX } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { FileDiff } from "../../protocol";

/**
 * Placeholder for one file whose patch has not loaded yet. It mirrors the real
 * `MergeDiff` / `UnifiedDiff` header (36px, same borders and fill) and the
 * measured 20px diff rows, so the swap is a fill rather than a layout change.
 *
 * A row is the diff's own two columns — CodeMirror's 26px number gutter flush
 * to the left edge, then the text — so every content bar starts on one x, and
 * a changed row is that same column tinted over a tinted row, the way
 * `unifiedMergeView` marks one. Every width comes from the file's index and
 * the row's index, never `Math.random()`, so screenshots and tests are stable.
 * One opacity pulse per block, and the block is only mounted when its row is
 * virtualized in.
 */

/** Path-bar width, percent. Deterministic per file index, 45–65%. */
const PATH_WIDTHS = [58, 47, 63, 52, 60, 45] as const;

/** Row pattern: three additions and two deletions over ten rows, so a short
 *  skeleton still reads as a diff rather than as a form. */
const LINE_KINDS = ["ctx", "add", "ctx", "ctx", "del", "ctx", "add", "ctx", "add", "del"] as const;

const ROW_PX = 20;
const HEADER_PX = 36;
/** Roughly a viewport of rows. A 10k-line file reserves 200k pixels, and the
 *  height past this is drawn by one striped element instead of 10k nodes. */
const MAX_ROWS = 24;

function lineWidth(index: number, row: number): number {
  return 38 + ((index * 13 + row * 17) % 44);
}

/** Text lines at the diff's own pitch, fading out — what the rows past
 *  `MAX_ROWS` would have looked like, for the cost of one element. */
const TAIL_STRIPES = `repeating-linear-gradient(to bottom, hsl(var(--muted-foreground) / 0.1) 6px, hsl(var(--muted-foreground) / 0.1) ${SKELETON_LINE_BAR_PX + 6}px, transparent ${SKELETON_LINE_BAR_PX + 6}px, transparent ${ROW_PX}px)`;
const TAIL_FADE = "linear-gradient(to bottom, black, transparent)";

export function FileDiffSkeleton({
  file,
  height,
  index,
}: {
  file?: FileDiff;
  /** The virtualizer's estimate for this file, so the skeleton occupies the
   *  same slot the estimate reserved. */
  height: number;
  index: number;
}) {
  // Rows fill the slot the estimate reserved: drawing fewer left a dead gap
  // under every file block, which is what made a loading diff read as broken.
  const fits = Math.max(1, Math.floor((height - HEADER_PX) / ROW_PX));
  const rows = Math.min(MAX_ROWS, fits);
  const tail = Math.max(0, height - HEADER_PX - rows * ROW_PX);
  const pathWidth = PATH_WIDTHS[index % PATH_WIDTHS.length];

  return (
    <div
      aria-busy
      data-testid="file-skeleton"
      data-path={file?.path}
      className="flex animate-pulse flex-col overflow-hidden [--animate-pulse:pulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none"
      style={{ height }}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-rule px-3 text-[13px]">
        <span
          className="h-3 min-w-0 shrink rounded-sm bg-muted-foreground/15"
          style={{ width: `${pathWidth}%` }}
        />
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* Where `+N −N` land on a listing that carries them, plus a stand-in
              for the header's action cluster. */}
          <span className="h-3 w-7 rounded-sm bg-muted-foreground/15" />
          <span className="h-3 w-5 rounded-sm bg-muted-foreground/15" />
          <span className="h-5 w-12 rounded bg-muted-foreground/10" />
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {Array.from({ length: rows }, (_, row) => {
          const kind = LINE_KINDS[row % LINE_KINDS.length];
          return (
            <div
              key={row}
              data-testid="file-skeleton-row"
              data-kind={kind}
              className={cn(
                "flex h-5 shrink-0 items-center",
                kind === "add" && "bg-ok/10",
                kind === "del" && "bg-destructive/10",
              )}
            >
              <span className="flex w-[26px] shrink-0 justify-end border-r border-border pr-1">
                <SkeletonBar h={SKELETON_LINE_BAR_PX} className="w-3" />
              </span>
              <span data-lane="text" className="flex min-w-0 flex-1 items-center pl-2 pr-3">
                <SkeletonBar
                  h={SKELETON_LINE_BAR_PX}
                  w={lineWidth(index, row)}
                  className={cn(
                    kind === "add" && "bg-ok/15",
                    kind === "del" && "bg-destructive/15",
                  )}
                />
              </span>
            </div>
          );
        })}
        {tail > 0 && (
          <div
            aria-hidden
            data-testid="file-skeleton-tail"
            className="ml-[34px] mr-3 min-h-0 flex-1"
            style={{
              backgroundImage: TAIL_STRIPES,
              maskImage: TAIL_FADE,
              WebkitMaskImage: TAIL_FADE,
            }}
          />
        )}
      </div>
    </div>
  );
}
