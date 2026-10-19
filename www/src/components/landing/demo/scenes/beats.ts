import type { DaemonEvent, SessionUpdate } from "@app/protocol";

export const say = (taskId: string, update: SessionUpdate): DaemonEvent => ({
  data: { task_id: taskId, update },
  event: "session.update",
});

export const tool = (
  taskId: string,
  id: string,
  title: string,
  kind: string,
  status: "pending" | "in_progress" | "completed",
): DaemonEvent =>
  say(taskId, { kind: "tool_call", status, title, tool_call_id: id, tool_kind: kind });
