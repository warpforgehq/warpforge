import type { CoreClient } from "./client";
import type { Constructor } from "./types";

export function TextMethods<TBase extends Constructor<CoreClient>>(Base: TBase) {
  return class extends Base {
    /** Draft a commit message or PR description by running the chosen agent
     *  one-shot over the task's diff. Resolves with the generated text. */
    async generateText(
      taskId: string,
      agentId: string,
      kind: "commit_message" | "pr_description" | "task_title" | "handoff" | "shelf_name",
      model?: string,
      options?: { accountId?: string; input?: string },
    ): Promise<string> {
      const result = (await this.request("text.generate", {
        account_id: options?.accountId,
        agent_id: agentId,
        input: options?.input,
        kind,
        model,
        task_id: taskId,
      })) as { text: string };
      return result.text;
    }

    /** Polish a user-written task prompt (title/description) one-shot via the
     *  chosen agent. Runs before a task exists, so it takes the raw prompt. */
    async enhancePrompt(
      project: string,
      agentId: string,
      prompt: string,
      model?: string,
    ): Promise<string> {
      const result = (await this.request("text.enhance", {
        agent_id: agentId,
        model,
        project,
        prompt,
      })) as { text: string };
      return result.text;
    }
  };
}
