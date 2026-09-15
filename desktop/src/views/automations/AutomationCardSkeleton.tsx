import { SkeletonBar, SkeletonBlock } from "@/components/ui/skeleton";

/**
 * Placeholder for one automation card. Mirrors `AutomationCard`'s chrome — the
 * rounded border card, a `px-3 pt-3` header, a badge row, two schedule lines
 * and a bordered footer with a button-shaped block — so the grid keeps its
 * column count and row height while the list loads.
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
        <div className="min-w-0 flex-1 space-y-1.5">
          <SkeletonBar h={12} className="w-40" tone="primary" />
          <SkeletonBar h={10} className="w-3/4" />
        </div>
        <SkeletonBar h={10} className="w-16 shrink-0" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
        <SkeletonBar h={14} className="w-16" />
        <SkeletonBar h={14} className="w-20" />
        <SkeletonBar h={14} className="w-14" />
      </div>

      <div className="mt-2.5 space-y-1 px-3">
        <SkeletonBar h={10} className="w-2/3" />
        <SkeletonBar h={10} className="w-1/2" />
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-rule px-3 py-2">
        <SkeletonBar h={10} className="w-12" />
        <span className="flex-1" />
        <SkeletonBar className="h-6 w-16 shrink-0" />
      </div>
    </SkeletonBlock>
  );
}
