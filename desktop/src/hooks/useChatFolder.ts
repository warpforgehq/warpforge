import { useQuery } from "@tanstack/react-query";

import { daemon } from "../daemon";
import type { ChatFolder } from "../protocol";

/** Query key of a chat's folder; invalidate it when its files may have changed. */
export const chatFolderKey = (taskId: string) => ["chatFolder", taskId] as const;

/**
 * A chat's folder and how many files it holds.
 * @param taskId The chat; null for a task, which has no such folder.
 * @returns The folder, undefined until loaded or for a task.
 */
export function useChatFolder(taskId: string | null): ChatFolder | undefined {
  return useQuery({
    enabled: taskId !== null,
    queryFn: () => daemon.chatFolder(taskId ?? ""),
    queryKey: chatFolderKey(taskId ?? ""),
  }).data;
}
