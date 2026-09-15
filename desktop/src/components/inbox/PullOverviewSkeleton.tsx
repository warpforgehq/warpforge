import { SkeletonBar, SkeletonBlock, skeletonWidth } from "@/components/ui/skeleton";

/**
 * The overview's two waiting shapes: the description body and the activity
 * timeline. Both reserve the rhythm the real blocks land in — five prose lines
 * at the description's measure, three thread cards for Activity — so comments
 * arrive without a jump. Widths are deterministic, and each variant owns one
 * pulse.
 */

const DESCRIPTION_LINES = 5;
const ACTIVITY_CARDS = 3;

export function PullOverviewSkeleton({ variant }: { variant: "description" | "activity" }) {
  if (variant === "description") {
    return (
      <SkeletonBlock
        role="status"
        aria-label="Loading description"
        data-testid="pull-description-skeleton"
        className="flex flex-col"
      >
        {Array.from({ length: DESCRIPTION_LINES }, (_, line) => (
          <div key={line} className="flex h-5 items-center">
            <SkeletonBar h={10} w={line === DESCRIPTION_LINES - 1 ? 35 : skeletonWidth(0, line)} />
          </div>
        ))}
      </SkeletonBlock>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-[13px] font-medium text-muted-foreground">Activity</h3>
      <SkeletonBlock
        role="status"
        aria-label="Loading activity"
        data-testid="pull-activity-skeleton"
        className="flex min-w-0 flex-col gap-2"
      >
        <div className="flex items-center gap-1.5">
          <SkeletonBar className="size-3.5 shrink-0" />
          <SkeletonBar h={10} className="w-28" />
          <SkeletonBar h={10} className="w-10" />
        </div>
        {Array.from({ length: ACTIVITY_CARDS }, (_, card) => (
          <div
            key={card}
            data-testid="pull-activity-skeleton-card"
            className="overflow-hidden rounded-md border border-border bg-card"
          >
            <div className="flex flex-col gap-3 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <SkeletonBar className="size-5 shrink-0 rounded-full" />
                <SkeletonBar h={10} className="w-24" />
                <SkeletonBar h={10} className="ml-auto w-10" />
              </div>
              <div className="flex flex-col">
                <div className="flex h-5 items-center">
                  <SkeletonBar h={10} w={skeletonWidth(card, 0)} />
                </div>
                <div className="flex h-5 items-center">
                  <SkeletonBar h={10} w={skeletonWidth(card, 1)} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </SkeletonBlock>
    </div>
  );
}
