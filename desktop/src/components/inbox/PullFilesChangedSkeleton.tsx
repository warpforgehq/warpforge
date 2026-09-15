import { SkeletonBar, SkeletonBlock, skeletonWidth } from "@/components/ui/skeleton";

/**
 * The changed-file list before its paths arrive. Mirrors `FileGroup`'s two
 * blocks: a 28px group header (icon, label, count, `+N −N`) and 24px file rows
 * under a left rule, so the headings above swap in place. The live
 * "N files changed" heading is rendered by the parent and stays put.
 */

const GROUPS = 2;
const ROWS_PER_GROUP = 4;

export function PullFilesChangedSkeleton() {
  return (
    <SkeletonBlock
      role="status"
      aria-label="Loading files"
      data-testid="pull-files-changed-skeleton"
      className="flex min-w-0 flex-col gap-1 xl:min-h-0 xl:flex-1 xl:overflow-y-auto"
    >
      {Array.from({ length: GROUPS }, (_, group) => (
        <div key={group} data-testid="pull-files-changed-group" className="flex min-w-0 flex-col">
          <div className="flex h-7 w-full min-w-0 shrink-0 items-center gap-1.5 px-1">
            <SkeletonBar className="size-3 shrink-0" />
            <SkeletonBar h={10} className="w-20 shrink-0" />
            <SkeletonBar h={10} className="w-4 shrink-0" />
            <SkeletonBar h={10} className="ml-auto w-12 shrink-0" />
          </div>
          <div className="ml-1 flex min-w-0 flex-col border-l border-border/60 pl-1.5">
            {Array.from({ length: ROWS_PER_GROUP }, (_row, row) => (
              <div
                key={row}
                data-testid="pull-files-changed-row"
                className="flex h-6 w-full min-w-0 items-center gap-1.5 rounded px-1.5"
              >
                <SkeletonBar className="size-3 shrink-0" />
                <SkeletonBar h={10} w={skeletonWidth(group, row)} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </SkeletonBlock>
  );
}
