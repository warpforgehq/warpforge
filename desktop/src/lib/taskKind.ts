import type { TaskInfo } from "@/protocol";

/**
 * @param task The task to classify.
 * @returns Whether it is a chat: no project, run in its own folder.
 */
export function isChat(task: Pick<TaskInfo, "kind">): boolean {
  return task.kind === "chat";
}
