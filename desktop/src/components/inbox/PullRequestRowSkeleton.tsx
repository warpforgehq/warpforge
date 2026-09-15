import { SkeletonBar, SkeletonBlock, skeletonWidth } from "@/components/ui/skeleton";

/**
 * The inbox list before its first page arrives. Mirrors `PullRequestRow`'s
 * geometry — `rounded-md px-2 py-1.5`, two lines at `gap-1`, the same meta and
 * title lanes — so a cold Inbox fills in without a layout shift. Eight rows,
 * clipped by the same scroller the real list uses.
 */
const ROW_COUNT = 8;

/** The repo bar is the only lane that grows; cap it so it never crowds the
 *  fixed numeric lanes to its right. */
const REPO_MAX_PERCENT = 40;

export function PullRequestRowSkeleton() {
  return (
    <div className="h-full min-h-0 overflow-y-auto px-2 py-2 [scrollbar-gutter:stable]">
      <SkeletonBlock data-testid="pull-request-skeleton" className="flex flex-col gap-px">
        {Array.from({ length: ROW_COUNT }, (_, row) => (
          <div
            key={row}
            data-testid="pull-request-skeleton-row"
            className="flex w-full min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 text-left"
          >
            <span className="flex min-w-0 items-center gap-1.5 text-[10px] leading-[14px]">
              <SkeletonBar className="size-3 shrink-0" />
              <SkeletonBar
                w={Math.min(skeletonWidth(row, 0), REPO_MAX_PERCENT)}
                h={8}
                className="shrink-0"
              />
              <SkeletonBar className="h-2.5 w-6 shrink-0" />
              <SkeletonBar className="h-2.5 w-10 shrink-0" />
              <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
                <span data-lane="status" className="flex size-3.5 shrink-0 items-center justify-center" />
                <SkeletonBar className="h-2.5 w-8 shrink-0" />
              </span>
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              <SkeletonBar w={skeletonWidth(row, 1)} h={10} className="shrink-0" />
            </span>
          </div>
        ))}
      </SkeletonBlock>
    </div>
  );
}
