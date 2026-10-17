import { Bot, UserRound } from "lucide-react";
import { useMemo } from "react";

import { useSmiths } from "@/hooks/useSmiths";
import { assigneeLabel, smithAssignee, smithIdFromAssignee } from "@/lib/smiths";
import { useSmithsStore } from "@/store/smiths";

/** Radix Select forbids an empty item value, so "nobody" needs a sentinel. */
export const UNASSIGNED = "__unassigned__";

/**
 * A Smith gets a bot, anyone else a person.
 * @param props.assignee the board item's assignee
 * @param props.className the icon's classes
 * @returns the icon
 */
export function AssigneeIcon({
  assignee,
  className,
}: {
  assignee: string | null | undefined;
  className?: string;
}) {
  const Icon = smithIdFromAssignee(assignee) === null ? UserRound : Bot;
  return <Icon className={className} />;
}

/**
 * @param assignee a board item's assignee
 * @returns what to show for it, a Smith by name; null when unassigned
 */
export function useAssigneeLabel(assignee: string | null | undefined): string | null {
  const smiths = useSmithsStore((state) => state.smiths);
  return assigneeLabel(assignee, smiths);
}

/**
 * The daemon refuses a Smith on an item outside its allowed projects, so only
 * those are offered.
 * @param project the item's project
 * @returns one assignee option per Smith that may work in it, by name
 */
export function useSmithAssigneeOptions(project: string): { value: string; label: string }[] {
  const smiths = useSmiths();
  return useMemo(
    () =>
      smiths
        .filter((smith) => smith.allowedProjects.includes(project))
        .map((smith) => ({ value: smithAssignee(smith.id), label: smith.name })),
    [project, smiths],
  );
}
