import { SkeletonBar, SkeletonBlock, skeletonWidth } from "@/components/ui/skeleton";

import { ROW_HEIGHT } from "../../components/changes/CommitPane";

/**
 * Placeholder for the changes rail's commit tree. A rail is a file tree, not a
 * list of file blocks, so it reserves the same chrome the rail mounts with —
 * the tab strip, a 36px pane header, the staged-count bar — and then 28px tree
 * rows with a checkbox, a status glyph, a path bar and a `+N −N` count.
 */

/** Depth per row, in `FileTreeRow`'s 12px steps: a section header, then its
 *  files, then a folder that opens one more. */
const DEPTHS = [0, 1, 1, 1, 1, 2, 2, 1] as const;

export function ChangesRailSkeleton() {
  return (
    <SkeletonBlock
      aria-label="Loading changes"
      data-testid="changes-rail-skeleton"
      className="flex h-full min-h-0 flex-col bg-card"
    >
      <div className="flex items-center gap-1 border-b border-rule px-2 pt-1">
        <SkeletonBar className="h-[26px] w-14 rounded-t" tone="primary" />
        <SkeletonBar className="h-[26px] w-12 rounded-t" />
        <SkeletonBar className="h-[26px] w-12 rounded-t" />
      </div>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <SkeletonBar h={14} className="w-24" tone="primary" />
        <SkeletonBar className="ml-auto h-5 w-5 shrink-0" />
        <SkeletonBar className="h-5 w-5 shrink-0" />
      </div>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-rule bg-secondary/55 px-3">
        <SkeletonBar className="size-3 shrink-0" />
        <SkeletonBar h={10} className="w-16" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden py-1.5">
        {Array.from({ length: DEPTHS.length }, (_, row) => (
          <div
            key={row}
            data-testid="changes-rail-skeleton-row"
            className="flex items-center gap-1.5 pr-2"
            style={{ height: ROW_HEIGHT, paddingLeft: DEPTHS[row] * 12 + 8 }}
          >
            <SkeletonBar className="size-3 shrink-0" />
            <SkeletonBar className="h-2.5 w-3 shrink-0" />
            <span className="flex min-w-0 flex-1 items-center">
              <SkeletonBar h={10} w={skeletonWidth(row, 0, 30, 70)} />
              <SkeletonBar h={10} className="ml-auto w-10 shrink-0" />
            </span>
          </div>
        ))}
      </div>
    </SkeletonBlock>
  );
}
