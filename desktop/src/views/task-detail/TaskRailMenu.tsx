import { TaskMenu } from "@/components/TaskMenu";
import type { TaskInfo } from "@/protocol";
import { usePins, type Pin } from "@/store/pins";
import { useUi } from "@/store/ui";

/**
 * The open task's actions menu, at the foot of the workspace rail.
 * @param task the open task
 * @returns the menu trigger
 */
export function TaskRailMenu({ task }: { task: TaskInfo }) {
  const pin: Pin = { id: task.id, kind: "task" };
  const pinned = usePins((state) => state.has(pin));
  const toggle = usePins((state) => state.toggle);
  const closeTask = useUi((state) => state.openTask);
  return (
    <TaskMenu
      task={task}
      pinned={pinned}
      side="left"
      onTogglePin={() => toggle(pin)}
      onClose={() => closeTask(null)}
    />
  );
}
