import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useRunnerStatus } from "@/hooks/useRunner";
import { useSmiths } from "@/hooks/useSmiths";
import { useUi } from "@/store/ui";

import type { TaskMode } from "../../components/TaskComposeBar";
import { daemon } from "../../daemon";
import type { AgentConfig, RunnerSettings, Snapshot, WorkflowMeta } from "../../protocol";
import { modelOption } from "./useTaskCreation";

/**
 * The New Task dialog's project, harness, mode and workflow template, with
 * the project's Factory defaults applied when Factory mode is chosen.
 * @param props.defaultProject The project the dialog opens on.
 * @param props.snapshot The daemon snapshot.
 * @param props.initialMode The mode the dialog opens in.
 * @returns The selection and its setters.
 */
export function useTaskSelection({
  defaultProject,
  snapshot,
  initialMode = "single",
}: {
  defaultProject: string | null;
  snapshot: Snapshot;
  initialMode?: TaskMode;
}) {
  const queryClient = useQueryClient();

  const firstProjectName = snapshot.projects[0]?.name ?? "";
  const enabledAgents = useMemo(
    () => snapshot.agents?.filter((candidate) => candidate.enabled) ?? [],
    [snapshot.agents],
  );
  const [project, setProject] = useState(defaultProject ?? firstProjectName);
  const [selectedAgent, setSelectedAgent] = useState(enabledAgents[0]?.id ?? "claude");
  /** Whether the person picked the harness; Factory defaults never override that. */
  const [agentPicked, setAgentPicked] = useState(false);
  const [defaultsApplied, setDefaultsApplied] = useState<string | null>(null);
  const [configPicks, setConfigPicks] = useState<Record<string, string | undefined>>({});
  const [mode, setMode] = useState<TaskMode>(initialMode);
  const [workflow, setWorkflow] = useState<string | null>(null);
  const smiths = useSmiths();
  const storedSmith = useUi((state) => state.newTaskSmith);
  const setStoredSmith = useUi((state) => state.setNewTaskSmith);
  /** The Smiths allowed in the project; New Task can start work as one. */
  const projectSmiths = useMemo(
    () => smiths.filter((candidate) => candidate.allowedProjects.includes(project)),
    [smiths, project],
  );
  // Not in Factory; a pick that no longer fits falls back to the agent.
  const smith =
    mode === "factory"
      ? undefined
      : projectSmiths.find((candidate) => candidate.id === storedSmith);

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
  const factorySettings = useRunnerStatus(project).data?.settings;

  /** The template Factory mode starts on: the project's default, else the first valid one. */
  const factoryDefault = (): WorkflowMeta | undefined =>
    workflows.find((candidate) => candidate.valid && candidate.id === factorySettings?.workflow) ??
    workflows.find((candidate) => candidate.valid);

  /** Select the project's Factory lead agent and, when it offers it, model. */
  const applyFactoryDefaults = (settings: RunnerSettings) => {
    const lead = enabledAgents.find((candidate) => candidate.id === settings.agent);
    if (!lead) return;
    setSelectedAgent(lead.id);
    const option = modelOption(lead.models ?? []);
    const offered = option?.options.some((choice) => choice.value === settings.model);
    setConfigPicks(option && settings.model && offered ? { [option.id]: settings.model } : {});
  };

  // In Factory mode the harness and model start from the project's Factory
  // defaults, however the dialog was opened, until the person picks one.
  useEffect(() => {
    if (mode !== "factory" || agentPicked || !factorySettings) return;
    if (defaultsApplied === project) return;
    setDefaultsApplied(project);
    applyFactoryDefaults(factorySettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the settings or mode change
  }, [mode, agentPicked, factorySettings, project, defaultsApplied]);

  // Opening straight into Factory mode waits for the templates to load.
  useEffect(() => {
    if (mode !== "factory" || workflow !== null || workflows.length === 0) return;
    const first = factoryDefault();
    if (first) setWorkflow(first.id);
    else setMode("single");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the list or mode changes
  }, [mode, workflow, workflows]);

  const changeProject = (nextProject: string) => {
    setProject(nextProject);
    // Only the workflow is project-scoped, so only the workflow is dropped.
    // Realising you picked the wrong project must not cost you the harness,
    // the model picks or the prompt you already typed.
    setWorkflow(null);
  };

  const changeAgent = (nextAgent: string) => {
    setAgentPicked(true);
    setSelectedAgent(nextAgent);
    setStoredSmith(null);
    // Config options are the harness's own selectors, so these cannot survive.
    setConfigPicks({});
  };

  const changeSmith = (id: string) => setStoredSmith(id);

  const changeWorkflow = (nextWorkflow: string | null) => {
    setWorkflow(nextWorkflow);
    setMode(nextWorkflow ? "factory" : "single");
  };

  const changeMode = (next: string) => {
    if (next !== "single" && next !== "orchestrator" && next !== "factory") return;
    if (next === "factory") {
      const first = factoryDefault();
      if (!first) return;
      setWorkflow((current) => current ?? first.id);
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
    changeSmith,
    changeWorkflow,
    configPicks,
    currentAgent,
    ejectWorkflow,
    factorySettings,
    hasValidWorkflows,
    mode,
    probeLoading,
    project,
    projectSmiths,
    selectedWorkflow,
    setConfigPicks,
    smith,
    workflow,
    workflows,
  };
}
