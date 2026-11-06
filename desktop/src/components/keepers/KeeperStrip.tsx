import { runLabel, STRIP_LENGTH, stripTone, type StripTone } from "@/lib/keepers";
import { cn } from "@/lib/utils";
import type { KeeperRun } from "@/protocol";

const TONE: Record<StripTone, string> = {
  green: "bg-ok/80",
  grey: "bg-muted-foreground/25",
  red: "bg-destructive/85 text-white",
  running: "animate-pulse border border-ok/60 bg-transparent",
};

/**
 * The keeper's last ten runs, oldest on the left: green, red with the count,
 * grey for a run that settled nothing.
 * @param runs The keeper's runs, oldest first.
 * @returns The strip, or a note when there are no runs.
 */
export function KeeperStrip({ runs }: { runs: readonly KeeperRun[] }) {
  if (runs.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No runs yet. The next commit is checked.</p>
    );
  }
  return (
    <ol aria-label="Last runs" className="flex items-center gap-0.5">
      {runs.slice(-STRIP_LENGTH).map((run) => {
        const tone = stripTone(run);
        return (
          <li
            key={run.id}
            data-tone={tone}
            title={runLabel(run)}
            aria-label={runLabel(run)}
            className={cn(
              "tnum flex h-4 min-w-4 items-center justify-center rounded-sm px-0.5 text-[10px] leading-none font-medium",
              TONE[tone],
            )}
          >
            {tone === "red" ? run.count : null}
          </li>
        );
      })}
    </ol>
  );
}
