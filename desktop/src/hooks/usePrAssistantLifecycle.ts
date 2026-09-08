import { useEffect, useRef } from "react";

import { daemon } from "@/daemon";
import { useInboxPulls } from "@/hooks/useInboxUnseen";
import { closedPrAssistantTasks, prTaskRef, unverifiedPrAssistantTasks } from "@/lib/taskOrigin";
import type { TaskInfo } from "@/protocol";

/** State lookups per poll: absence is the ordinary case, so this is capped. */
const VERIFY_BUDGET = 3;

/**
 * Retire a PR Assistant conversation once its pull request is merged or
 * closed. Rides the inbox poll. Mount once, with every project — a listing
 * scoped to one says nothing about the others.
 */
export function usePrAssistantLifecycle(projects: readonly string[]): void {
  const listing = useInboxPulls(projects);
  const checked = useRef<Set<string>>(new Set());

  useEffect(() => {
    const pulls = listing.data;
    if (!pulls) return;
    let cancelled = false;

    const archive = async (task: TaskInfo) => {
      try {
        await daemon.request("task.archive", { task_id: task.id });
      } catch {
        // The TTL sweep is the backstop; no need to alarm anyone.
      }
    };

    void (async () => {
      const tasks = daemon.getState().snapshot.tasks;
      for (const task of closedPrAssistantTasks(tasks, pulls)) {
        if (cancelled) return;
        await archive(task);
      }
      for (const task of unverifiedPrAssistantTasks(tasks, pulls, checked.current, VERIFY_BUDGET)) {
        if (cancelled) return;
        const ref = prTaskRef(task);
        if (!ref) {
          checked.current.add(task.id);
          continue;
        }
        try {
          const details = await daemon.pullDetails(task.project, ref.number);
          checked.current.add(task.id);
          if (details.state !== "open" && !cancelled) await archive(task);
        } catch {
          // Unreachable repo: retry on a later poll, do not mark it checked.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [listing.data]);
}
