import { toast } from "sonner";

import { daemon } from "@/daemon";
import { configRole } from "@/lib/configRole";
import type { TaskInfo } from "@/protocol";

/** Longest title the daemon keeps. */
export const MAX_TITLE_LENGTH = 80;

/**
 * The first line of an agent's answer, without a code fence around it.
 * @param text the agent's raw answer
 * @returns the title, possibly empty
 */
export function generatedTitle(text: string): string {
  return (
    text
      .replace(/^```(?:text)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .split(/\r?\n/, 1)[0]
      ?.trim()
      .slice(0, MAX_TITLE_LENGTH) ?? ""
  );
}

/**
 * Ask the task's own agent and model for a new title and save it; a failure
 * becomes a toast.
 * @param task the task to retitle
 */
export async function regenerateTaskTitle(
  task: Pick<TaskInfo, "id" | "agent" | "configOptions">,
): Promise<void> {
  try {
    const model = task.configOptions?.find(
      (option) => configRole(option) === "model",
    )?.currentValue;
    const text = await daemon.generateText(task.id, task.agent, "task_title", model || undefined);
    const title = generatedTitle(text);
    if (!title) throw new Error("The agent returned an empty title");
    await daemon.setTaskTitle(task.id, title);
  } catch (error) {
    toast.error("Could not regenerate task title", {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}
