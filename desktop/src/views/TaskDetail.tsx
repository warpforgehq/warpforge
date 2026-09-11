import type { Snapshot, TaskInfo } from "../protocol";
import { TaskDetailPanes } from "./task-detail/TaskDetailPanes";
import { useTaskDetail } from "./task-detail/useTaskDetail";

interface Props {
  task: TaskInfo;
  snapshot: Snapshot;
  onOpenTask: (id: string) => void;
  onOpenPush: () => void;
}

export default function TaskDetail({ task, snapshot, onOpenTask, onOpenPush }: Props) {
  const detail = useTaskDetail(task, snapshot);
  return (
    <TaskDetailPanes task={task} onOpenTask={onOpenTask} onOpenPush={onOpenPush} detail={detail} />
  );
}
