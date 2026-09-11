import type { DeleteSettledResult, ExternalSession } from "../protocol";
import type { CoreClient } from "./client";
import type { Constructor } from "./types";

export function TaskMethods<TBase extends Constructor<CoreClient>>(Base: TBase) {
  return class extends Base {
    /**
     * Create a task. `origin` marks a task a surface owns rather than the board
     * — `pr-review` for the PR Assistant's conversation, which is filtered out
     * of every board list (`lib/taskOrigin`).
     */
    async taskCreate(params: {
      project: string;
      prompt: string;
      agent: string;
      tags?: string[];
      origin?: string;
      worktree?: boolean;
      includeRuntimeContext?: boolean;
      defaultModel?: string;
    }): Promise<string> {
      const result = (await this.request("task.create", {
        agent: params.agent,
        default_model: params.defaultModel,
        include_runtime_context: params.includeRuntimeContext ?? true,
        origin: params.origin,
        project: params.project,
        prompt: params.prompt,
        tags: params.tags ?? [],
        worktree: params.worktree ?? false,
      })) as { taskId?: string } | null;
      const taskId = result?.taskId;
      if (!taskId) throw new Error("the daemon created no task");
      return taskId;
    }

    /** Full message of the task repo's latest commit; empty if it has none. */
    async lastCommitMessage(taskId: string): Promise<string> {
      const result = (await this.request("git.lastCommitMessage", { task_id: taskId })) as {
        message?: string;
      };
      return result?.message ?? "";
    }

    /** Update a task's title. */
    async setTaskTitle(taskId: string, title: string) {
      await this.request("task.setTitle", { task_id: taskId, title });
    }

    async deleteTask(taskId: string) {
      await this.request("task.delete", { task_id: taskId });
    }

    /** Bulk-delete every settled task on a project's "N done" shelf. */
    async deleteSettledTasks(project?: string): Promise<DeleteSettledResult> {
      return (await this.request("task.deleteSettled", { project })) as DeleteSettledResult;
    }

    async archiveTask(taskId: string) {
      await this.request("task.archive", { task_id: taskId });
    }

    /** List resumable claude/codex sessions on disk for a project's cwd. */
    async listSessions(project: string): Promise<ExternalSession[]> {
      const result = await this.request("sessions.list", { project });
      const sessions = (result as { sessions?: ExternalSession[] })?.sessions;
      return Array.isArray(sessions) ? sessions : [];
    }

    /** Resume an external session as a new task; returns the new task id. */
    async resumeTask(
      project: string,
      agent: string,
      sessionId: string,
      title: string,
    ): Promise<string> {
      const result = await this.request("task.resume", {
        agent,
        project,
        session_id: sessionId,
        title,
      });
      return (result as { taskId?: string })?.taskId ?? "";
    }
  };
}
