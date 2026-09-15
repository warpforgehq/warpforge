import { SkeletonBar, SkeletonBlock, skeletonWidth } from "@/components/ui/skeleton";

import { ESTIMATED_ROW_HEIGHT } from "./BacklogList";

/**
 * Backlog rows before the first page arrives. Mirrors `BacklogRow`'s one-line
 * geometry: `h-9` plus its bottom border, a source dot, the title, then the
 * same status / priority / source / assignee / updated lanes at the same
 * widths and the same breakpoints, so no column arrives from nowhere on swap.
 * Ten rows fill the cold list; one row stands in for the next page.
 */
export function BacklogRowSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <SkeletonBlock data-testid="backlog-skeleton" className="flex flex-col">
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          data-testid="backlog-skeleton-row"
          className="flex min-w-0 items-center border-b border-rule pr-2"
          style={{ height: ESTIMATED_ROW_HEIGHT }}
        >
          <div className="flex h-full min-w-0 flex-1 items-center gap-3 pl-3 pr-2">
            <SkeletonBar className="size-1.5 shrink-0 rounded-full" />
            <span className="flex min-w-0 flex-1 items-center">
              <SkeletonBar h={10} w={skeletonWidth(row, 0, 30, 75)} tone="primary" />
            </span>
            <SkeletonBar className="hidden h-[18px] w-[7.5rem] shrink-0 rounded-md sm:block" />
            <SkeletonBar className="hidden h-2.5 w-16 shrink-0 lg:block" />
            <SkeletonBar className="hidden h-2.5 w-32 shrink-0 xl:block" />
            <SkeletonBar className="hidden h-2.5 w-28 shrink-0 md:block" />
            <SkeletonBar className="h-2.5 w-16 shrink-0" />
          </div>
          {/* The row's hover actions keep their width reserved, so the lanes
              above never shift when one appears. */}
          <div className="w-[4.5rem] shrink-0" />
        </div>
      ))}
    </SkeletonBlock>
  );
}
