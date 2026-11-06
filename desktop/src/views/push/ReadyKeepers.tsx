import { Loader2 } from "lucide-react";

import { currentFindings, keeperStatus, type KeeperStatus } from "@/lib/keepers";
import { cn } from "@/lib/utils";
import type { KeeperEntry, KeeperRun, KeeperTaskState } from "@/protocol";

const LABEL: Record<KeeperStatus, { text: string; tone: string }> = {
  accepted: { text: "Accepted", tone: "text-ok" },
  draft: { text: "Draft ready", tone: "text-muted-foreground" },
  findings: { text: "Findings", tone: "text-destructive" },
  fixing: { text: "Fixing", tone: "text-muted-foreground" },
  green: { text: "Green", tone: "text-ok" },
  idle: { text: "Not checked yet", tone: "text-muted-foreground" },
  inconclusive: { text: "Inconclusive", tone: "text-muted-foreground" },
  needs_you: { text: "Needs you", tone: "text-destructive" },
  off: { text: "Off", tone: "text-muted-foreground" },
  running: { text: "Checking", tone: "text-muted-foreground" },
  waiting: { text: "Waiting", tone: "text-warn" },
};

/**
 * The Create PR dialog's ready keepers, each with its live state. It only
 * reports; creating the pull request never waits for it.
 * @param ready The task's ready keepers and their runs.
 * @param state The task's keeper state.
 * @param error Why the check did not start, if it did not.
 * @returns The section, or nothing without ready keepers.
 */
export function ReadyKeepers({
  ready,
  state,
  error,
}: {
  ready: readonly { entry: KeeperEntry; runs: KeeperRun[] }[];
  state: KeeperTaskState | undefined;
  error: string | null;
}) {
  if (ready.length === 0) return null;
  return (
    <section
      aria-label="Keepers before the pull request"
      className="flex shrink-0 flex-col gap-1 border-t px-5 py-2 text-[13px]"
    >
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {ready.map(({ entry, runs }) => {
          const status = keeperStatus(true, runs, state?.loops[entry.id]);
          const count = currentFindings(state, runs).length;
          const label = LABEL[status];
          return (
            <li key={entry.id} data-status={status} className="flex items-center gap-1.5">
              <span className="font-medium text-foreground">
                {entry.definition?.name || entry.id}
              </span>
              <span className={cn("flex items-center gap-1", label.tone)}>
                {status === "running" && <Loader2 aria-hidden className="size-3 animate-spin" />}
                {status === "findings" && count > 0
                  ? `${count} ${count === 1 ? "finding" : "findings"}`
                  : label.text}
              </span>
            </li>
          );
        })}
      </ul>
      {error && <p className="text-muted-foreground">Not checked: {error}.</p>}
    </section>
  );
}
