import { SkeletonBar, SkeletonBlock, skeletonWidth } from "@/components/ui/skeleton";

import { ESTIMATED_ROW_HEIGHT } from "./BacklogList";

/**
 * Backlog rows before the first page arrives. Mirrors `BacklogRow`'s one-line
 * geometry: `h-9` plus its bottom border, a status lane, the title, and a
 * right-aligned meta lane. Ten rows fill the cold list; one row stands in for
 * the next page while it is fetching.
 */
export function BacklogRowSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <SkeletonBlock data-testid="backlog-skeleton" className="flex flex-col">
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          data-testid="backlog-skeleton-row"
          className="flex min-w-0 items-center border-b border-border/40 pr-2"
          style={{ height: ESTIMATED_ROW_HEIGHT }}
        >
          <div className="flex h-full min-w-0 flex-1 items-center gap-3 pl-3 pr-2">
            <SkeletonBar className="size-1.5 shrink-0 rounded-full" />
            <SkeletonBar w={skeletonWidth(row, 0)} h={10} className="shrink-0" />
            <SkeletonBar className="ml-auto h-2.5 w-12 shrink-0" />
          </div>
        </div>
      ))}
    </SkeletonBlock>
  );
}
