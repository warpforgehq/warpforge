import { SkeletonBar, SkeletonBlock, skeletonWidth } from "@/components/ui/skeleton";

/**
 * Placeholder for the push preview while the outgoing commits are read. The
 * slot it fills is the commit scroller, so it draws `CommitRow`'s own shape —
 * `px-3 py-2`, a commit glyph, a subject line and a meta line of hash, author
 * and file count — three deep, which covers the `min-h-40` the list starts at.
 * The branch header and the push button live outside this slot and are not
 * drawn here.
 */

const COMMITS = 3;

export function PushPreviewSkeleton() {
  return (
    <SkeletonBlock
      role="status"
      aria-label="Reading outgoing commits"
      data-testid="push-preview-skeleton"
      className="flex min-h-40 flex-col"
    >
      {Array.from({ length: COMMITS }, (_, row) => (
        <div
          key={row}
          data-testid="push-preview-skeleton-row"
          className="flex w-full items-start gap-2 rounded-md px-3 py-2"
        >
          <SkeletonBar className="mt-0.5 size-4 shrink-0" />
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
