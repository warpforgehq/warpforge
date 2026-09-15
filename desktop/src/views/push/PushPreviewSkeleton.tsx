import { SkeletonBar, SkeletonBlock, skeletonWidth } from "@/components/ui/skeleton";

/**
 * Placeholder for the push preview while the outgoing commits are read. Mirrors
 * the left column's shape — a branch line, a stack of commit rows, and a
 * button-shaped block — inside the same `min-h-40` slot the spinner occupied.
 */

const COMMITS = 3;

export function PushPreviewSkeleton() {
  return (
    <SkeletonBlock
      role="status"
      aria-label="Reading outgoing commits"
      data-testid="push-preview-skeleton"
      className="flex min-h-40 flex-col gap-2 p-2"
    >
      <SkeletonBar h={12} className="w-48" tone="primary" />
      <div className="flex flex-col">
        {Array.from({ length: COMMITS }, (_, row) => (
          <div
            key={row}
            data-testid="push-preview-skeleton-row"
            className="flex h-7 items-center gap-2 px-1"
          >
            <SkeletonBar className="size-4 shrink-0" />
            <SkeletonBar h={10} w={skeletonWidth(row, 0)} />
          </div>
        ))}
      </div>
      <SkeletonBar className="mt-auto h-8 w-24" />
    </SkeletonBlock>
  );
}
