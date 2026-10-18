import { useQuery } from "@tanstack/react-query";
import { GitBranch, Share2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useStartInFactory } from "@/hooks/useRunner";
import { configRole } from "@/lib/configRole";
import { cn } from "@/lib/utils";
import { worktreeBaseBranch } from "@/lib/worktreeBase";

import { AgentConfigBar } from "../../components/AgentConfigBar";
import type { ComposerHandle } from "../../components/Composer";
import { Composer } from "../../components/Composer";
import { RunPreview } from "../../components/RunPreview";
import { type TaskMode, WorkflowPicker } from "../../components/TaskComposeBar";
import type { GitBranchList, ProjectFile, Snapshot, WorktreeBase } from "../../protocol";
import { daemonQuery } from "../../query";
import { useUi } from "../../store/ui";
import { AdvisorPicker } from "./AdvisorPicker";
import { BasePicker } from "./BasePicker";
import { ChipDivider, HarnessChip, ProjectChip, SmithLockedChips, ToggleChip } from "./chips";
import { FactoryItems } from "./FactoryItems";
import { FactoryLocationNote, FactoryOptions } from "./FactoryOptions";
import { ModeSelector } from "./ModeSelector";
import { useAdvisorPick } from "./useAdvisorPick";
import { type FactorySeed, useFactoryBatch } from "./useFactoryBatch";
import { useFactoryOptions } from "./useFactoryOptions";
import { useSmithStart } from "./useSmithStart";
import { splitConfigPicks, useTaskCreation } from "./useTaskCreation";
import { useTaskSelection } from "./useTaskSelection";

export type { FactorySeed } from "./useFactoryBatch";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  snapshot: Snapshot;
  defaultProject: string | null;
  initialPrompt?: string;
  /** Backlog item this task is being started from, if any. The created task is
   *  linked to it so the board can show (and reopen) the run it produced. */
  backlogItemId?: string | null;
  /** The mode the surface opens in. */
  initialMode?: TaskMode;
  /** Several backlog items to start in Factory at once, instead of a prompt. */
  factorySeed?: FactorySeed | null;
  /** Called with the new task's id once it is created. */
  onCreated?: (taskId: string) => void;
}

/**
 * New-task surface. It is mounted inside the app shell rather than in a modal
 * portal: the sidebar remains available, while this transient state replaces
 * the current main view. Sending the first prompt creates the task and closes
 * the surface.
 */
export default function NewTaskDialog({
  open,
  onOpenChange,
  snapshot,
  defaultProject,
  initialPrompt,
  backlogItemId,
  initialMode,
  factorySeed,
  onCreated,
}: Props) {
  const {
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
  } = useTaskSelection({
    defaultProject,
    initialMode: factorySeed ? "factory" : initialMode,
    snapshot,
  });
  const factory = useFactoryOptions({
    onWorkflow: changeWorkflow,
    project,
    selected: selectedWorkflow,
    settings: factorySettings,
    workflows,
  });
  const batch = useFactoryBatch(factorySeed ?? { items: [], kind: "items" }, project);
  const startMany = useStartInFactory(project);
  const inFactory = mode === "factory";

  const advisor = useAdvisorPick(agentChoices, agent);
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const useWorktree = useUi((s) => s.newTaskWorktree);
  const setUseWorktree = useUi((s) => s.setNewTaskWorktree);
  const [worktreeBase, setWorktreeBase] = useState<WorktreeBase | null>(null);
  const composerRef = useRef<ComposerHandle>(null);

  // A base names a branch of one repo; it means nothing in another project.
  useEffect(() => setWorktreeBase(null), [project]);

  const branchQuery = useQuery({
    enabled: open && !!project,
    queryFn: daemonQuery<GitBranchList>("git.branches", { project }),
    queryKey: ["branches", "project", project],
  });
  const isolated = inFactory
    ? factory.resolved === "worktree"
    : useWorktree && mode !== "orchestrator";
  const picksBase = isolated && !(inFactory && factory.deliver);
  const branch =
    inFactory && factory.deliver
      ? null
      : ((picksBase ? worktreeBaseBranch(worktreeBase) : null) ??
        branchQuery.data?.current ??
        null);
  const filesQuery = useQuery({
    enabled: !!project,
    queryFn: daemonQuery<ProjectFile[]>("file.list", { project }),
    queryKey: ["fileList", "new", project],
  });
  const projectFiles = Array.isArray(filesQuery.data) ? filesQuery.data : [];

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape inside an open chip menu closes that menu, not the page.
      if (event.target instanceof Element && event.target.closest("[role=menu]")) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [close, open]);

  const { create, setShareContext, setTags, shareContext, tags } = useTaskCreation({
    agent,
    advisor: advisor.pick,
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
  });

  const startAsSmith = useSmithStart({
    backlogItemId,
    close,
    onCreated,
    orchestrator: mode === "orchestrator",
    project,
    smith,
    useWorktree,
  });

  const startBatch = async () => {
    if (!workflow) return;
    const ids = await batch.resolveIds();
    const { model } = splitConfigPicks(agentOptions, configPicks);
    const result = await startMany(ids, {
      agent,
      deliver: factory.deliver,
      model: model ?? null,
      runLocation: factory.location,
      workflow,
    });
    if (result) close();
  };

  const selectedProject = snapshot.projects.find((candidate) => candidate.name === project) ?? null;
  const runningForProject = snapshot.services.filter(
    (service) =>
      service.project === project && service.status === "running" && service.allocatedPort > 0,
  );
  const canStart = factorySeed
    ? !!selectedWorkflow && (batch.count ?? 0) > 0
    : !!prompt.trim() && !!project && (!inFactory || !!selectedWorkflow);
  const startLabel = factorySeed
    ? `Start ${batch.count ?? ""} in Factory`.replace("  ", " ")
    : inFactory
      ? "Start in Factory"
      : mode === "orchestrator"
        ? smith
          ? `Start ${smith.name} as orchestrator`
          : "Start orchestrator"
        : smith
          ? `Start as ${smith.name}`
          : "Start task";
  const workspaceLine = inFactory ? (
    <FactoryLocationNote options={factory} />
  ) : mode === "orchestrator" ? (
    "Lead and workers share your current checkout."
  ) : useWorktree ? (
    worktreeLine(worktreeBase)
  ) : (
    "Runs in your current checkout."
  );

  const toolbar = (
    <>
      {!factorySeed && (
        <ProjectChip
          projects={snapshot.projects}
          project={project}
          title={
            selectedProject
              ? selectedProject.path +
                " · ports " +
                selectedProject.portRange[0] +
                "–" +
                selectedProject.portRange[1]
              : "Choose a project"
          }
          onChange={changeProject}
        />
      )}
      <HarnessChip
        agents={agentChoices}
        agent={agent}
        title={
          currentAgent ? "Runs " + currentAgent.acpCommand + " for this task" : "Choose a harness"
        }
        onChange={changeAgent}
        smiths={mode !== "factory" && !factorySeed ? projectSmiths : undefined}
        smith={smith}
        onSmith={changeSmith}
      />
      <ChipDivider />
      {smith ? (
        <SmithLockedChips
          smith={smith}
          accountLabel={snapshot.accounts?.find((a) => a.id === smith.accountId)?.label}
        />
      ) : (
        <AgentConfigBar
          options={agentOptions.map((opt) =>
            configRole(opt) === "model" && currentAgent?.lastModel
              ? ({ ...opt, inheritedValue: currentAgent.lastModel } as typeof opt & {
                  inheritedValue: string;
                })
              : opt,
          )}
          picks={configPicks}
          loading={probeLoading}
          onSelect={(option, value) =>
            setConfigPicks((previous) => ({ ...previous, [option.id]: value }))
          }
        />
      )}
      {!factorySeed && !smith && (
        <>
          <ChipDivider />
          <AdvisorPicker agents={agentChoices} available={mode === "single"} state={advisor} />
        </>
      )}
      <ChipDivider />
      {!inFactory && (
        <ToggleChip
          active={useWorktree && mode !== "orchestrator"}
          disabled={mode === "orchestrator"}
          icon={GitBranch}
          label="Worktree"
          title={
            mode === "orchestrator"
              ? "An orchestrator and its workers share your current checkout."
              : "Run in an isolated git worktree. Remembered for the next task."
          }
          onClick={() => setUseWorktree(!useWorktree)}
        />
      )}
      {picksBase && !factorySeed && (
        <BasePicker
          branches={branchQuery.data}
          project={project}
          value={worktreeBase}
          onChange={setWorktreeBase}
        />
      )}
      {!factorySeed && !smith && (
        <ToggleChip
          active={shareContext}
          icon={Share2}
          label="Services"
          title={
            runningForProject.length > 0
              ? "Agent sees " +
                runningForProject
                  .map((service) => service.name + ":" + service.allocatedPort)
                  .join(", ")
              : "No services running for this project."
          }
          onClick={() => setShareContext((current) => !current)}
        />
      )}
    </>
  );

  if (!open) return null;

  return (
    <div
      data-testid="new-task-page"
      className="glass-opaque flex h-full min-h-0 flex-col bg-background"
    >
      <header className="flex shrink-0 items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          New task
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={close}
          aria-label="Close new task"
          title="Close (Esc)"
          type="button"
        >
          <X className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[1100px] flex-col justify-center gap-6 px-4 pb-14 sm:px-6">
          {/* Nothing between the title and the composer may appear or disappear
              with the mode: this block anchors the screen, and the pipeline
              picker lives in the run-context row below instead. */}
          <div className="flex flex-col items-center gap-3">
            <h1 className="text-center text-2xl font-semibold tracking-tight">
              What are you trying to ship?
            </h1>
            <ModeSelector
              mode={mode}
              hasValidWorkflows={hasValidWorkflows}
              factoryOnly={!!factorySeed}
              onChange={changeMode}
            />
          </div>

          {/* The composer is the only bordered island on this screen: everything
              else — mode, run context, tags — sits flat on the canvas so the eye
              lands on the one thing that has to be filled in. */}
          <div>
            {/* No `key` here on purpose: remounting the composer when the
                project or harness changes threw away the prompt already typed. */}
            {factorySeed ? (
              <FactoryItems batch={batch} toolbar={toolbar} />
            ) : (
              <Composer
                ref={composerRef}
                className="p-0"
                initialValue={prompt}
                onDraftChange={setPrompt}
                files={projectFiles}
                filesLoading={filesQuery.isLoading}
                imageSupported
                hideSendButton
                onSend={smith ? startAsSmith : create}
                toolbar={toolbar}
                placeholder={
                  selectedWorkflow
                    ? "What should the " + selectedWorkflow.name + " Factory task work on?"
                    : mode === "orchestrator"
                      ? smith
                        ? `What should ${smith.name} coordinate?`
                        : "What should the orchestrator coordinate?"
                      : smith
                        ? `What should ${smith.name} work on?`
                        : "What should the agent do?"
                }
              />
            )}

            <div className="mt-2 flex h-8 items-center gap-2">
              {inFactory && (
                <WorkflowPicker
                  workflows={workflows}
                  selected={selectedWorkflow}
                  onSelect={changeWorkflow}
                  onEject={ejectWorkflow}
                />
              )}
              <p
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-1.5 text-[11px]",
                  inFactory && !selectedWorkflow ? "text-warn" : "text-muted-foreground",
                )}
              >
                {inFactory && !selectedWorkflow ? (
                  <span className="truncate">Select a valid workflow before starting.</span>
                ) : (
                  <>
                    {branch && (
                      <>
                        <GitBranch aria-hidden className="size-3 shrink-0" />
                        <span className="max-w-48 truncate font-medium text-foreground/75">
                          {branch}
                        </span>
                        <span aria-hidden>·</span>
                      </>
                    )}
                    <span className="truncate">{workspaceLine}</span>
                  </>
                )}
              </p>
              {!smith && (
                <>
                  <label htmlFor="task-tags" className="sr-only">
                    Tags
                  </label>
                  <input
                    id="task-tags"
                    value={tags}
                    onChange={(event) => setTags(event.target.value)}
                    placeholder="Tags"
                    className="h-8 w-28 shrink-0 rounded-md bg-transparent px-2 text-[13px] transition-colors placeholder:text-muted-foreground/70 hover:bg-secondary/60 focus-visible:bg-secondary/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </>
              )}
              <Button
                type="button"
                size="sm"
                onClick={() => (factorySeed ? void startBatch() : composerRef.current?.submit())}
                disabled={!canStart}
                className="h-8 shrink-0"
              >
                {startLabel}
              </Button>
            </div>
            {inFactory && <FactoryOptions options={factory} />}
          </div>

          {/* Reserved so that switching modes — or landing in Workflow with no
              pipeline picked yet, where the preview has nothing to draw — never
              re-centres the column above it. */}
          <div className="min-h-[4.5rem]">
            <RunPreview
              agent={smith?.agent ?? agent}
              agents={agentChoices}
              mode={mode}
              workflow={selectedWorkflow}
              deliver={inFactory && factory.deliver}
              smith={smith}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function worktreeLine(base: WorktreeBase | null): string {
  switch (base?.kind) {
    case "origin":
      return "Runs in an isolated worktree on a new branch from origin's latest.";
    case "existing":
      return "Runs in an isolated worktree on this branch; pushes go to it.";
    case "pullRequest":
      return "Runs in an isolated worktree on pull request #" + base.number + "'s branch.";
    default:
      return "Runs in an isolated git worktree.";
  }
}
