import { SkeletonBar, SkeletonBlock, skeletonWidth } from "@/components/ui/skeleton";

import { ROW_HEIGHT } from "./CommitPane";

/**
 * Placeholder for a short file list whose entries have not arrived — the shelf
 * and stash entry lists, and the ignored-files tree. It reuses the changes
 * rail's file-row idiom: a 28px row with a glyph, a path bar, and an optional
 * right-aligned meta bar, so the list swaps in place instead of jumping from a
 * sentence.
 */
export function FileListSkeleton({
  rows = 4,
  label = "Loading files",
  meta = true,
  "data-testid": testId = "file-list-skeleton",
}: {
  rows?: number;
  label?: string;
  /** The ignored tree has no per-row count lane; the list bodies do. */
  meta?: boolean;
  "data-testid"?: string;
}) {
  return (
    <SkeletonBlock
      role="status"
      aria-label={label}
      data-testid={testId}
      className="flex flex-col px-3"
    >
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          data-testid={`${testId}-row`}
          className="flex items-center gap-2"
          style={{ height: ROW_HEIGHT }}
        >
          <SkeletonBar className="size-3.5 shrink-0" />
          <SkeletonBar h={10} w={skeletonWidth(row, 0)} className="shrink-0" />
          {meta && <SkeletonBar h={10} className="ml-auto w-10 shrink-0" />}
        </div>
      ))}
    </SkeletonBlock>
  );
}
