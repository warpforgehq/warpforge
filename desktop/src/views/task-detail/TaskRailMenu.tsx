import { useMemo, useSyncExternalStore } from "react";

import { TaskMenu } from "@/components/TaskMenu";
import { daemon } from "@/daemon";
import { buildTaskGroupIndex, isTaskGroupPinned, setTaskGroupPinned } from "@/lib/taskGroups";
import type { TaskInfo } from "@/protocol";
import { useUi } from "@/store/ui";

/**
 * The open task's actions menu, at the foot of the workspace rail.
 * @param task the open task
 * @returns the menu trigger
 */
export function TaskRailMenu({ task }: { task: TaskInfo }) {
  const { snapshot } = useSyncExternalStore(daemon.subscribe, daemon.getState);
  const pinnedTaskIds = useUi((s) => s.pinnedTaskIds);
  const setPinnedTaskIds = useUi((s) => s.setPinnedTaskIds);
  const closeTask = useUi((s) => s.openTask);
  const index = useMemo(() => buildTaskGroupIndex(snapshot.tasks), [snapshot.tasks]);
  const pinned = isTaskGroupPinned(index, pinnedTaskIds, task.id);
  return (
    <TaskMenu
      task={task}
      pinned={pinned}
      side="left"
      onTogglePin={() =>
        setPinnedTaskIds(setTaskGroupPinned(index, pinnedTaskIds, task.id, !pinned))
      }
      onClose={() => closeTask(null)}
    />
  );
}
