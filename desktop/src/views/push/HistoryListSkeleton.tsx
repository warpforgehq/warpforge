import { SkeletonBar, SkeletonBlock, skeletonWidth } from "@/components/ui/skeleton";

/** Three compact history rows while branch commits are read. */
const COMMITS = 3;

export function HistoryListSkeleton() {
  return (
    <SkeletonBlock
      role="status"
      aria-label="Reading commits"
      data-testid="history-list-skeleton"
      className="flex flex-col"
    >
      {Array.from({ length: COMMITS }, (_, row) => (
        <div
          key={row}
          data-testid="history-list-skeleton-row"
          className="flex w-full items-start gap-2 px-2 py-1"
        >
          <SkeletonBar className="mt-0.5 size-3 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex h-5 items-center">
              <SkeletonBar h={10} w={skeletonWidth(row, 0, 40, 85)} tone="primary" />
            </span>
            <span className="mt-0.5 flex h-5 items-center gap-2">
              <SkeletonBar h={8} className="w-12 shrink-0" />
              <SkeletonBar h={8} w={skeletonWidth(row, 1, 20, 40)} />
              <SkeletonBar h={8} className="ml-auto w-10 shrink-0" />
            </span>
          </span>
        </div>
      ))}
    </SkeletonBlock>
  );
}
