import { SkeletonBar, SkeletonBlock, skeletonWidth } from "@/components/ui/skeleton";

import { ROW_HEIGHT } from "../../components/changes/CommitPane";

/**
 * Placeholder for the changes rail's commit tree. A rail is a file tree, not a
 * list of file blocks, so it reserves the same `CommitPane` chrome — a 36px
 * header, then 28px rows with a checkbox, a file glyph, a path bar and a
 * `+N −N` count — instead of the diff's file shapes.
 */

const ROWS = 8;

export function ChangesRailSkeleton() {
  return (
    <SkeletonBlock
      aria-label="Loading changes"
      data-testid="changes-rail-skeleton"
      className="flex h-full min-h-0 flex-col bg-card"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-rule px-3">
        <SkeletonBar h={12} className="w-24" tone="primary" />
        <SkeletonBar h={12} className="w-8" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden py-1.5">
        {Array.from({ length: ROWS }, (_, row) => (
          <div key={row} className="flex items-center gap-2 px-3" style={{ height: ROW_HEIGHT }}>
            <SkeletonBar className="size-3.5 shrink-0" />
            <SkeletonBar className="size-3.5 shrink-0" />
            <SkeletonBar h={10} w={skeletonWidth(row, 0)} />
            <SkeletonBar className="ml-auto w-10 shrink-0" h={10} />
          </div>
        ))}
      </div>
    </SkeletonBlock>
  );
}
