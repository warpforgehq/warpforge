import { SkeletonBar, SkeletonBlock } from "@/components/ui/skeleton";

/**
 * Placeholder for a settings list whose rows are still being detected — the
 * language-server and agent panels. Mirrors the real rows' `px-4 py-2.5`
 * rhythm: a logo lane, a name bar, a version bar and a right-aligned
 * button-shaped block, so the list does not flash a centred sentence.
 */
export function SettingsListSkeleton({
  rows = 4,
  label = "Loading",
  "data-testid": testId = "settings-list-skeleton",
}: {
  rows?: number;
  label?: string;
  "data-testid"?: string;
}) {
  return (
    <SkeletonBlock
      role="status"
      aria-label={label}
      data-testid={testId}
      className="flex flex-col"
    >
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          data-testid={`${testId}-row`}
          className="flex items-center justify-between gap-4 border-t border-rule px-4 py-2.5 first:border-t-0"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SkeletonBar className="size-4 shrink-0" />
            <SkeletonBar h={12} className="w-28 shrink-0" tone="primary" />
            <SkeletonBar h={10} className="w-16 shrink-0" />
          </div>
          <SkeletonBar className="h-7 w-16 shrink-0" />
        </div>
      ))}
    </SkeletonBlock>
  );
}
