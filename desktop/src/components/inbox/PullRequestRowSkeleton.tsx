import { SkeletonBar, SkeletonBlock, skeletonWidth } from "@/components/ui/skeleton";

/**
 * The inbox list before its first page arrives. Mirrors `PullRequestRow`'s
 * geometry — `rounded-md px-2 py-1.5`, a 14px meta line and a 16px title line
 * at `gap-1`, the same status and age lanes — so a cold Inbox fills in without
 * a layout shift. Eight rows, clipped by the same scroller the real list uses.
 */
const ROW_COUNT = 8;

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
              {/* The repo name is the only lane that grows, and it keeps its own
                  band: clamping the default one put every row on the cap. */}
              <SkeletonBar w={skeletonWidth(row, 0, 18, 40)} h={8} className="shrink-0" />
              <SkeletonBar className="h-2.5 w-6 shrink-0" />
              <SkeletonBar className="h-2.5 w-10 shrink-0" />
              <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
                <span
                  data-lane="status"
                  className="flex size-3.5 shrink-0 items-center justify-center"
                >
                  <SkeletonBar className="size-3 rounded-full" />
                </span>
                <SkeletonBar className="h-2.5 w-8 shrink-0" />
              </span>
            </span>
            <span className="flex h-4 min-w-0 items-center gap-1.5 text-[12px] leading-4">
              <SkeletonBar w={skeletonWidth(row, 1, 45, 90)} h={10} tone="primary" />
            </span>
          </div>
        ))}
      </SkeletonBlock>
    </div>
  );
}
