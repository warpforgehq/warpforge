import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { runnerStatusKey } from "@/hooks/useRunner";

import type { TaskMode } from "../../components/TaskComposeBar";
import { daemon } from "../../daemon";
import type {
  AdvisorPick,
  ConfigOption,
  PromptSubmission,
  WorkflowMeta,
  WorktreeBase,
} from "../../protocol";
import { useUi } from "../../store/ui";
import type { FactoryOptions } from "./useFactoryOptions";

/**
 * The option that picks the model, among a harness's config options.
 * @param agentOptions The harness's config options.
 * @returns The model option, when the harness has one.
 */
export function modelOption(agentOptions: ConfigOption[]): ConfigOption | undefined {
  return agentOptions.find((option) =>
    ((option.category ?? "") + " " + option.id + " " + option.name).toLowerCase().includes("model"),
  );
}

/**
 * The model pick among an agent's config options, and every other pick as
 * a session override.
 * @param agentOptions The harness's config options.
 * @param configPicks What the person picked, by option id.
 * @returns The model and the remaining overrides.
 */
export function splitConfigPicks(
  agentOptions: ConfigOption[],
  configPicks: Record<string, string | undefined>,
): { model: string | undefined; overrides: Record<string, string> } {
  const modelOpt = modelOption(agentOptions);
  const overrides: Record<string, string> = {};
  for (const option of agentOptions) {
    if (option.id === modelOpt?.id) continue;
    const pick = configPicks[option.id];
    if (pick != null) overrides[option.id] = pick;
  }
  return { model: modelOpt ? configPicks[modelOpt.id] : undefined, overrides };
}

export function useTaskCreation({
  advisor,
  agent,
  agentOptions,
  backlogItemId,
  close,
  configPicks,
  factory,
  mode,
  onCreated,
  project,
  selectedWorkflow,
  useWorktree,
  workflow,
  worktreeBase,
}: {
  /** The advisor pick; sent only for a single-agent task. */
  advisor: AdvisorPick | null;
  agent: string;
  agentOptions: ConfigOption[];
  backlogItemId?: string | null;
  close: () => void;
  configPicks: Record<string, string | undefined>;
  /** Factory mode's choices; ignored in the other modes. */
  factory: FactoryOptions;
  mode: TaskMode;
  onCreated?: (taskId: string) => void;
  project: string;
  selectedWorkflow: WorkflowMeta | null;
  useWorktree: boolean;
  workflow: string | null;
  worktreeBase: WorktreeBase | null;
}) {
  const queryClient = useQueryClient();
  const openTask = useUi((s) => s.openTask);
  const autoNameTasks = useUi((s) => s.autoNameTasks);
  const textGenAgentId = useUi((s) => s.textGenAgentId);
  const textGenModel = useUi((s) => s.textGenModel);
  const [tags, setTags] = useState("");
  const [shareContext, setShareContext] = useState(true);

  const create = async (submission: PromptSubmission) => {
    if (!submission.text.trim() || !project) return;
    const userTags = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    // Non-model picks go as config_overrides, applied via
    // session/setConfigOption before the first prompt.
    const { model: modelPick, overrides: configOverrides } = splitConfigPicks(
      agentOptions,
      configPicks,
    );
    const inFactory = mode === "factory";
    const delivers = inFactory && factory.deliver;
    const isolated =
      mode === "orchestrator" ? false : inFactory ? factory.resolved === "worktree" : useWorktree;

    let response: unknown;
    try {
      response = await daemon.request("task.create", {
        project,
        prompt: submission.text.trim(),
        attachments: submission.attachments,
        agent,
        tags: mode === "orchestrator" ? [...userTags, "orchestrator-chat"] : userTags,
        include_runtime_context: shareContext,
        worktree: isolated,
        worktree_base: isolated && !delivers ? (worktreeBase ?? undefined) : undefined,
        default_model: modelPick,
        config_overrides: configOverrides,
        workflow: workflow ?? undefined,
        backlog_item_id: backlogItemId ?? undefined,
        advisor: mode === "single" ? (advisor ?? undefined) : undefined,
        factory: delivers ? { deliver: true, runLocation: factory.location } : undefined,
      });
    } catch (error) {
      // A workflow can fail validation daemon-side after the list loads; keep
      // the surface open so the prompt is not lost.
      toast.error("Could not start the task", {
        description: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const taskId =
      (response as { taskId?: string } | null)?.taskId ??
      (response as { result?: { taskId?: string } } | null)?.result?.taskId ??
      null;
    if (!taskId) {
      close();
      return;
    }
    const queued = (response as { started?: boolean } | null)?.started === false;
    if (delivers) void queryClient.invalidateQueries({ queryKey: runnerStatusKey(project) });
    if (backlogItemId && !delivers) {
      try {
        await daemon.linkWorkItemTask(backlogItemId, taskId);
        void queryClient.invalidateQueries({ queryKey: ["backlog", project] });
      } catch (error) {
        // The task itself succeeded; a failed link must not strand the user
        // on a still-open dialog with no task opened. Report it and continue.
        toast.error("Task started, but linking it to the backlog item failed", {
          description: error instanceof Error ? error.message : String(error),
        });
      }
    }
    onCreated?.(taskId);
    openTask(taskId);
    toast.success(
      queued ? "Queued in Factory" : selectedWorkflow ? "Factory task started" : "Task started",
      {
        description: queued
          ? "It starts on its own as soon as the project's limits allow."
          : selectedWorkflow
            ? selectedWorkflow.name + " running in " + project
            : (mode === "orchestrator" ? "Orchestrator" : "Agent") +
              " session created for " +
              project,
        action: {
          label: "Open task",
          onClick: () => openTask(taskId),
        },
        duration: 8000,
      },
    );
    if (autoNameTasks && textGenAgentId) {
      void (async () => {
        try {
          const generated = await daemon.generateText(
            taskId,
            textGenAgentId,
            "task_title",
            textGenModel ?? undefined,
          );
          if (generated?.trim()) {
            await daemon.setTaskTitle(taskId, generated.trim().slice(0, 80));
          }
        } catch {
          // Task creation should never feel slow or noisy.
        }
      })();
    }
    close();
  };

  return { create, setShareContext, setTags, shareContext, tags };
}
