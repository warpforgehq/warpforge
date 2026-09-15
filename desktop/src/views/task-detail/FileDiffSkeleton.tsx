import { cn } from "@/lib/utils";

import type { FileDiff } from "../../protocol";

/**
 * Placeholder for one file whose patch has not loaded yet. It mirrors the real
 * `MergeDiff` / `UnifiedDiff` header (36px, same borders and fill) and the
 * measured 20px diff rows, so the swap is a fill rather than a layout change.
 *
 * Every width comes from the file's index and the row's index — never
 * `Math.random()` — so screenshots and tests are stable. One opacity pulse per
 * block, and the block is only mounted when its row is virtualized in.
 */

/** Path-bar width, percent. Deterministic per file index, 45–65%. */
const PATH_WIDTHS = [58, 47, 63, 52, 60, 45] as const;

/** Row pattern: three additions and two deletions over ten rows, so a short
 *  skeleton still reads as a diff rather than as a form. */
const LINE_KINDS = ["ctx", "add", "ctx", "ctx", "del", "ctx", "add", "ctx", "add", "del"] as const;

const ROW_PX = 20;
const HEADER_PX = 36;
const MAX_LINES = 10;
const MIN_LINES = 6;

function lineWidth(index: number, row: number): number {
  return 38 + ((index * 13 + row * 17) % 44);
}

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
  // Match the estimator's line count (its floor is eight lines), capped so a
  // 10k-line file does not draw a 10k-row skeleton. The remainder is a faint
  // tail, which keeps the measured height equal to the estimate.
  const estimatedLines = Math.ceil((height - HEADER_PX) / ROW_PX);
  const lines = Math.min(MAX_LINES, Math.max(MIN_LINES, estimatedLines));
  const tail = Math.max(0, height - HEADER_PX - lines * ROW_PX);
  const pathWidth = PATH_WIDTHS[index % PATH_WIDTHS.length];

  return (
    <div
      aria-busy
      data-testid="file-skeleton"
      data-path={file?.path}
      className="flex animate-pulse flex-col overflow-hidden [--animate-pulse:pulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none"
      style={{ height }}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-secondary/30 px-3 text-xs">
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
      <div className="flex min-h-0 flex-1 flex-col py-2">
        {Array.from({ length: lines }, (_, row) => {
          const kind = LINE_KINDS[row % LINE_KINDS.length];
          return (
            <div key={row} className="flex h-5 shrink-0 items-center gap-2 px-3">
              <span className="ml-auto h-2.5 w-4 shrink-0 rounded-sm bg-muted-foreground/10" />
              <span
                className={cn(
                  "h-2.5 rounded-sm",
                  kind === "add" && "bg-ok/15",
                  kind === "del" && "bg-destructive/15",
                  kind === "ctx" && "bg-muted-foreground/10",
                )}
                style={{ width: `${lineWidth(index, row)}%` }}
              />
            </div>
          );
        })}
        {tail > 0 && (
          <div className="min-h-0 flex-1 bg-gradient-to-b from-secondary/20 to-transparent" />
        )}
      </div>
    </div>
  );
}
