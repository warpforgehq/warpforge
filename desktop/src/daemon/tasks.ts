import type {
  AdvisorPick,
  DeleteSettledResult,
  ExternalSession,
  TaskPullRequest,
} from "../protocol";
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
      advisor?: AdvisorPick;
    }): Promise<string> {
      const result = (await this.request("task.create", {
        advisor: params.advisor,
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

    /** Turn a surface-owned task (the PR Assistant's) into a board task. */
    async adoptTask(taskId: string) {
      await this.request("task.adopt", { task_id: taskId });
    }

    /**
     * Merge a task's worktree branch back into its base branch. When
     * `removeWorktree` is true the checkout and branch are removed afterwards.
     * Returns a message naming what happened (fast-forward or merge commit);
     * rejects with git's reason on a conflict or refusal.
     */
    async mergeWorktree(taskId: string, removeWorktree: boolean): Promise<string> {
      const result = (await this.request("task.mergeWorktree", {
        task_id: taskId,
        remove_worktree: removeWorktree,
      })) as { message?: string } | null;
      return result?.message ?? "Merged";
    }

    async deleteTask(taskId: string) {
      await this.request("task.delete", { task_id: taskId });
    }

    /** Bulk-delete every settled task on a project's "N done" shelf. */
    async deleteSettledTasks(project?: string): Promise<DeleteSettledResult> {
      return (await this.request("task.deleteSettled", { project })) as DeleteSettledResult;
    }

    /** With `removeWorktree`, the checkout and its local branch go too; the
     *  daemon refuses while the agent is mid-turn or the checkout is dirty. */
    async archiveTask(taskId: string, removeWorktree = false) {
      await this.request("task.archive", { remove_worktree: removeWorktree, task_id: taskId });
    }

    /**
     * Ask for worktree tasks' pull requests. The answer is the daemon's cache;
     * entries older than `maxAgeSecs` are re-checked and arrive as events.
     */
    async refreshTaskPullRequests(taskIds?: string[], maxAgeSecs?: number) {
      const asked = this.pullRequestEventSeq;
      const result = (await this.request("task.pullRequests", {
        max_age_secs: maxAgeSecs,
        task_ids: taskIds,
      })) as { pullRequests?: Record<string, TaskPullRequest> } | null;
      const next = { ...result?.pullRequests };
      const current = this.state.taskPullRequests ?? {};
      for (const [taskId, seq] of this.pullRequestEventAt) {
        if (seq <= asked) continue;
        if (current[taskId]) next[taskId] = current[taskId];
        else delete next[taskId];
      }
      this.setState({ taskPullRequests: next });
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
