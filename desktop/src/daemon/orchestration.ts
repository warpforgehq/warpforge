import type { OrchestratorConfig, WorkflowDecision, WorkflowMeta } from "../protocol";
import type { CoreClient } from "./client";
import type { Constructor } from "./types";

export function OrchestrationMethods<TBase extends Constructor<CoreClient>>(Base: TBase) {
  return class extends Base {
    /** Start an orchestration: planner → workers → reviewers pipeline. */
    async orchestrateStart(
      project: string,
      goal: string,
    ): Promise<{ graphId: string; taskId: string }> {
      const result = await this.request("orchestrate.start", { goal, project });
      const r = result as { graphId?: string; taskId?: string };
      return { graphId: r.graphId ?? "", taskId: r.taskId ?? "" };
    }

    /** List active orchestration graphs. */
    async orchestrateList(): Promise<unknown[]> {
      const result = await this.request("orchestrate.list", {});
      const graphs = (result as { graphs?: unknown[] })?.graphs;
      return Array.isArray(graphs) ? graphs : [];
    }

    /** Get the orchestrator configuration. */
    async orchestrateGetConfig(): Promise<OrchestratorConfig> {
      const result = await this.request("orchestrate.getConfig", {});
      return result as OrchestratorConfig;
    }

    /** Save the orchestrator configuration. */
    async orchestrateSaveConfig(config: OrchestratorConfig): Promise<boolean> {
      const result = await this.request("orchestrate.saveConfig", { config });
      return (result as { ok?: boolean })?.ok ?? false;
    }

    // ── Workflow RPCs ──

    /** Workflows selectable for a project: its own files plus built-ins. */
    async workflowList(project: string): Promise<WorkflowMeta[]> {
      const result = await this.request("workflow.list", { project });
      const workflows = (result as { workflows?: WorkflowMeta[] })?.workflows;
      return Array.isArray(workflows) ? workflows : [];
    }

    /** Copy a built-in workflow into the project so it can be customized. */
    async workflowEject(project: string, id: string): Promise<string> {
      const result = await this.request("workflow.eject", { id, project });
      return (result as { path?: string })?.path ?? "";
    }

    /** Soft-pause a pipeline: the running stage finishes, the next won't start. */
    async workflowPause(task: string): Promise<void> {
      await this.request("workflow.pause", { task });
    }

    /** Resume a paused pipeline; `note` reaches the next stage as guidance. */
    async workflowResume(task: string, note?: string): Promise<void> {
      await this.request("workflow.resume", { note, task });
    }

    /** Answer a stage's pending question. */
    async workflowReply(task: string, message: string): Promise<void> {
      await this.request("workflow.reply", { message, task });
    }

    /** Decide what an out-of-rounds pipeline does next. */
    async workflowDecide(
      task: string,
      decision: WorkflowDecision,
      opts?: { rounds?: number; note?: string },
    ): Promise<void> {
      await this.request("workflow.decide", {
        decision,
        note: opts?.note,
        rounds: opts?.rounds,
        task,
      });
    }
  };
}
