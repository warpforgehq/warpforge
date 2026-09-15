import { SkeletonBar, SkeletonBlock } from "@/components/ui/skeleton";

/**
 * Placeholder for one automation card. Mirrors `AutomationCard`'s chrome — the
 * rounded border card, a `px-3 pt-3` header with its enable switch, a row of
 * pill badges, two schedule lines behind their icon lane, and a bordered
 * footer with a badge and a button — so the grid keeps its column count and
 * row height while the list loads.
 */
export function AutomationCardSkeleton() {
  return (
    <SkeletonBlock
      role="status"
      aria-label="Loading automation"
      data-testid="automation-card-skeleton"
      className="flex min-w-0 flex-col rounded-lg border border-border bg-card"
    >
      <div className="flex items-start gap-2 px-3 pt-3">
        <div className="min-w-0 flex-1">
          <span className="flex h-5 items-center">
            <SkeletonBar h={12} className="w-40" tone="primary" />
          </span>
          <span className="mt-0.5 flex h-4 items-center">
            <SkeletonBar h={10} className="w-3/4" />
          </span>
        </div>
        <SkeletonBar className="h-5 w-9 shrink-0 rounded-full" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
        <SkeletonBar className="h-[18px] w-16 rounded-full" />
        <SkeletonBar className="h-[18px] w-20 rounded-full" />
        <SkeletonBar className="h-[18px] w-14 rounded-full" />
      </div>

      <div className="mt-2.5 space-y-1 px-3">
        {[0, 1].map((line) => (
          <div key={line} className="flex h-5 items-center gap-1.5">
            <SkeletonBar className="size-3.5 shrink-0" />
            <SkeletonBar h={10} className={line === 0 ? "w-2/3" : "w-1/2"} />
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-rule px-3 py-2">
        <SkeletonBar className="h-[18px] w-16 rounded-full" />
        <span className="flex-1" />
        <SkeletonBar className="h-6 w-16 shrink-0 rounded" />
      </div>
    </SkeletonBlock>
  );
}
