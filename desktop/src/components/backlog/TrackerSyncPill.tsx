import { Loader2 } from "lucide-react";

import type { ProjectSources } from "@/protocol";

/**
 * The trackers a pull is waiting on, as a sentence fragment.
 *
 * @param sources The project's available sources, or undefined while unknown.
 * @returns "GitHub", "GitHub and Linear", or "trackers" when unknown.
 */
export function trackerNames(sources: ProjectSources | undefined): string {
  const names = [sources?.github && "GitHub", sources?.linear && "Linear"].filter(Boolean);
  return names.length > 0 ? names.join(" and ") : "trackers";
}

/**
 * A floating note that the board is still pulling from its trackers, shown
 * once local rows are already on screen.
 *
 * @param props.sources The project's available sources, for the label.
 */
export function TrackerSyncPill({ sources }: { sources: ProjectSources | undefined }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
      <div
        role="status"
        className="flex animate-[scale-in_160ms_var(--ease-out)] items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-[12px] text-muted-foreground shadow-md backdrop-blur motion-reduce:animate-none"
      >
        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        Loading {trackerNames(sources)}…
      </div>
    </div>
  );
}
