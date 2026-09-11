import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import type { TaskMode } from "../../components/TaskComposeBar";
import { daemon } from "../../daemon";
import type { AgentConfig, Snapshot, WorkflowMeta } from "../../protocol";

export function useTaskSelection({
  defaultProject,
  snapshot,
}: {
  defaultProject: string | null;
  snapshot: Snapshot;
}) {
  const queryClient = useQueryClient();

  const firstProjectName = snapshot.projects[0]?.name ?? "";
  const enabledAgents = useMemo(
    () => snapshot.agents?.filter((candidate) => candidate.enabled) ?? [],
    [snapshot.agents],
  );
  const [project, setProject] = useState(defaultProject ?? firstProjectName);
  const [selectedAgent, setSelectedAgent] = useState(enabledAgents[0]?.id ?? "claude");
  const [configPicks, setConfigPicks] = useState<Record<string, string | undefined>>({});
  const [mode, setMode] = useState<TaskMode>("single");
  const [workflow, setWorkflow] = useState<string | null>(null);

  const agent = enabledAgents.some((candidate) => candidate.id === selectedAgent)
    ? selectedAgent
    : (enabledAgents[0]?.id ?? "claude");
  const currentAgent = (snapshot.agents ?? []).find((candidate) => candidate.id === agent);
  const agentOptions = currentAgent?.models ?? [];
  const probeLoading = !!currentAgent && currentAgent.enabled && agentOptions.length === 0;

  const workflowsQuery = useQuery({
    enabled: !!project,
    queryFn: () => daemon.workflowList(project),
    queryKey: ["workflows", project],
  });
  const workflows: WorkflowMeta[] = workflowsQuery.data ?? [];
  const selectedWorkflow = workflows.find((candidate) => candidate.id === workflow) ?? null;

  const changeProject = (nextProject: string) => {
    setProject(nextProject);
    // Only the workflow is project-scoped, so only the workflow is dropped.
    // Realising you picked the wrong project must not cost you the harness,
    // the model picks or the prompt you already typed.
    setWorkflow(null);
    setMode((current) => (current === "workflow" ? "single" : current));
  };

  const changeAgent = (nextAgent: string) => {
    setSelectedAgent(nextAgent);
    // Config options are the harness's own selectors, so these cannot survive.
    setConfigPicks({});
  };

  const changeWorkflow = (nextWorkflow: string | null) => {
    setWorkflow(nextWorkflow);
    setMode(nextWorkflow ? "workflow" : "single");
  };

  const changeMode = (next: string) => {
    if (next !== "single" && next !== "orchestrator" && next !== "workflow") return;
    if (next === "workflow") {
      const firstValidWorkflow = workflows.find((candidate) => candidate.valid);
      if (!firstValidWorkflow) return;
      setWorkflow((current) => current ?? firstValidWorkflow.id);
    } else {
      setWorkflow(null);
    }
    setMode(next);
  };

  const ejectWorkflow = async (id: string) => {
    try {
      const path = await daemon.workflowEject(project, id);
      toast.success("Workflow copied to project", { description: path });
      await queryClient.invalidateQueries({ queryKey: ["workflows", project] });
    } catch (error) {
      toast.error("Could not copy workflow", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const agentChoices: AgentConfig[] =
    enabledAgents.length > 0
      ? enabledAgents
      : [{ acpCommand: "claude", displayName: "Claude", enabled: true, id: "claude", models: [] }];
  const hasValidWorkflows = workflows.some((candidate) => candidate.valid);

  return {
    agent,
    agentChoices,
    agentOptions,
    changeAgent,
    changeMode,
    changeProject,
    changeWorkflow,
    configPicks,
    currentAgent,
    ejectWorkflow,
    hasValidWorkflows,
    mode,
    probeLoading,
    project,
    selectedWorkflow,
    setConfigPicks,
    workflow,
    workflows,
  };
}
