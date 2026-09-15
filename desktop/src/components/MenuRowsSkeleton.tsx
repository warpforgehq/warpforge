import { SkeletonBar, SkeletonBlock, skeletonWidth } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PROJECT_ROW_HEIGHT } from "@/views/task-detail/projectFileTree";

/**
 * Placeholder for a file picker whose rows have not arrived — Quick Open and the
 * composer's `@` mention popover. Mirrors a file row: a glyph lane, the path,
 * and a dim hint pinned right, on the file tree's measured 28px row so the list
 * swaps in place. Name and hint widths are deterministic per row, each in its
 * own band so the column does not collapse onto one width.
 */
export function MenuRowsSkeleton({
  rows = 5,
  label = "Loading files",
  className,
  "data-testid": testId = "menu-rows-skeleton",
}: {
  rows?: number;
  label?: string;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <SkeletonBlock
      role="status"
      aria-label={label}
      data-testid={testId}
      className={cn("flex flex-col", className)}
    >
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          data-testid={`${testId}-row`}
          className="flex items-center gap-2 px-3"
          style={{ height: PROJECT_ROW_HEIGHT }}
        >
          <SkeletonBar className="size-3.5 shrink-0" />
          <SkeletonBar h={10} w={skeletonWidth(row, 0, 30, 55)} className="shrink-0" />
          <SkeletonBar h={8} w={skeletonWidth(row, 1, 15, 35)} className="ml-auto shrink-0" />
        </div>
      ))}
    </SkeletonBlock>
  );
}
