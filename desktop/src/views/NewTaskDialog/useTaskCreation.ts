import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { TaskMode } from "../../components/TaskComposeBar";
import { daemon } from "../../daemon";
import type { ConfigOption, PromptSubmission, WorkflowMeta } from "../../protocol";
import { useUi } from "../../store/ui";

export function useTaskCreation({
  agent,
  agentOptions,
  backlogItemId,
  close,
  configPicks,
  mode,
  project,
  selectedWorkflow,
  useWorktree,
  workflow,
}: {
  agent: string;
  agentOptions: ConfigOption[];
  backlogItemId?: string | null;
  close: () => void;
  configPicks: Record<string, string | undefined>;
  mode: TaskMode;
  project: string;
  selectedWorkflow: WorkflowMeta | null;
  useWorktree: boolean;
  workflow: string | null;
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
    const modelOpt = agentOptions.find((option) =>
      ((option.category ?? "") + " " + option.id + " " + option.name)
        .toLowerCase()
        .includes("model"),
    );
    const modelPick = modelOpt ? configPicks[modelOpt.id] : undefined;
    // Forward all non-model picks as config_overrides so they are applied via
    // session/setConfigOption before the first prompt.
    const configOverrides: Record<string, string> = {};
    for (const option of agentOptions) {
      if (option.id === modelOpt?.id) continue;
      const pick = configPicks[option.id];
      if (pick != null) configOverrides[option.id] = pick;
    }

    let response: unknown;
    try {
      response = await daemon.request("task.create", {
        project,
        prompt: submission.text.trim(),
        attachments: submission.attachments,
        agent,
        tags: mode === "orchestrator" ? [...userTags, "orchestrator-chat"] : userTags,
        include_runtime_context: shareContext,
        worktree: mode === "orchestrator" ? false : useWorktree,
        default_model: modelPick,
        config_overrides: configOverrides,
        workflow: workflow ?? undefined,
        backlog_item_id: backlogItemId ?? undefined,
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
    if (backlogItemId) {
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
    openTask(taskId);
    toast.success(selectedWorkflow ? "Workflow started" : "Task started", {
      description: selectedWorkflow
        ? selectedWorkflow.name + " pipeline running in " + project
        : (mode === "orchestrator" ? "Orchestrator" : "Agent") + " session created for " + project,
      action: {
        label: "Open task",
        onClick: () => openTask(taskId),
      },
      duration: 8000,
    });
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
