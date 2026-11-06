import { ShieldAlert } from "lucide-react";

import { useTaskKeepers } from "@/hooks/useTaskKeepers";
import { keeperPushWarnings } from "@/lib/keepers";

/**
 * A strip above the push and pull request footers when the task's keepers
 * are not all green. It warns and never blocks.
 * @param taskId The task being pushed, if any.
 * @returns The strip, or nothing when every keeper is green.
 */
export function KeeperWarning({ taskId }: { taskId: string | null }) {
  const warnings = keeperPushWarnings(useTaskKeepers(taskId));
  if (warnings.length === 0) return null;
  return (
    <div
      role="status"
      className="flex shrink-0 items-start gap-2 border-t border-warn/30 bg-warn/10 px-5 py-2 text-[13px] text-warn"
    >
      <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0">
        Keepers are not green — {warnings.join(" · ")}. You can still push; the Keepers tab has the
        details.
      </p>
    </div>
  );
}
