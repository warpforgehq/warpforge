import { useTaskKeepers } from "@/hooks/useTaskKeepers";
import { keeperWorst, type KeeperWorst } from "@/lib/keepers";
import { cn } from "@/lib/utils";

export const KEEPER_WORST_META: Record<KeeperWorst, { label: string; dotClass: string }> = {
  failing: { dotClass: "bg-destructive", label: "Keepers need attention" },
  running: { dotClass: "bg-muted-foreground motion-safe:animate-pulse", label: "Keepers checking" },
};

/**
 * @param taskId The task.
 * @returns The worst state of the task's keepers, or null when there is nothing to show.
 */
export function useKeeperWorst(taskId: string): KeeperWorst | null {
  return keeperWorst(useTaskKeepers(taskId));
}

/**
 * The keepers' mark on a pull-request icon: a dot over its top-right corner,
 * so the icon keeps its width. Sits in a `relative` parent.
 * @param worst The keepers' worst state.
 * @returns The dot, or nothing when the keepers are green.
 */
export function KeeperDot({ worst }: { worst: KeeperWorst | null }) {
  if (!worst) return null;
  return (
    <span
      aria-hidden
      data-task-keepers={worst}
      className={cn(
        "absolute -top-0.5 -right-0.5 size-1.5 rounded-full ring-1 ring-background",
        KEEPER_WORST_META[worst].dotClass,
      )}
    />
  );
}
