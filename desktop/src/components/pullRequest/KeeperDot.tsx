import type { KeeperWorst } from "@/lib/keepers";
import { CHECKING_DOT } from "@/lib/liveActivity";
import { cn } from "@/lib/utils";

export const KEEPER_WORST_META: Record<KeeperWorst, { label: string; dotClass: string }> = {
  failing: { dotClass: "bg-destructive", label: "Keepers need attention" },
  running: { dotClass: CHECKING_DOT, label: "Keepers checking" },
};

/**
 * A pull request's summary with the keepers' state after it, for a title or
 * an accessible name.
 * @param summary The pull request's own summary.
 * @param worst The keepers' worst state.
 * @returns The joined phrase.
 */
export function withKeeperLabel(summary: string, worst: KeeperWorst | null): string {
  return worst ? `${summary} · ${KEEPER_WORST_META[worst].label}` : summary;
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
