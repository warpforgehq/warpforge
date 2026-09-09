import { useQuery } from "@tanstack/react-query";
import { Bot, Loader2, MessageSquareCode, Sparkles } from "lucide-react";
import { useSyncExternalStore } from "react";
import * as React from "react";

import { AgentLogo } from "@/components/AgentLogo";
import { ChatTranscript } from "@/components/ChatTranscript";
import type { ComposerHandle } from "@/components/Composer";
import { IntentButton, PickerMenu } from "@/components/inbox/PullAssistantControls";
import { daemon } from "@/daemon";
import { useTaskSessionUpdates } from "@/hooks/useTaskSessionUpdates";
import { configRole } from "@/lib/configRole";
import { prAssistantPrompt, type PrAssistantIntent } from "@/lib/prAssistantPrompt";
import { sessionActivity } from "@/lib/sessionActivity";
import { findPrAssistantTask, PR_REVIEW_ORIGIN, prTaskTag } from "@/lib/taskOrigin";
import type {
  AgentConfig,
  ConfigOption,
  PullRequestDetails,
  PullRequestSummary,
  TaskInfo,
} from "@/protocol";
import { useUi } from "@/store/ui";

/** Subscribed wrapper: keeps tasks and agents out of the inbox's props. */
export function PullAssistantLive({
  pr,
  details,
}: {
  pr: PullRequestSummary;
  details: PullRequestDetails | null;
}) {
  const state = useSyncExternalStore(daemon.subscribe, daemon.getState);
  return (
    <PullAssistant
      pr={pr}
      details={details}
      tasks={state.snapshot.tasks}
      agents={state.snapshot.agents ?? []}
    />
  );
}

/**
 * An agent on this pull request. One conversation per PR, reopened not
 * respawned; both buttons are openings into the same thread.
 */
export function PullAssistant({
  pr,
  details,
  tasks,
  agents,
}: {
  pr: PullRequestSummary;
  details: PullRequestDetails | null;
  /** Every task the daemon knows about — the shadow task is found in here. */
  tasks: readonly TaskInfo[];
  agents: readonly AgentConfig[];
}) {
  const task = React.useMemo(() => findPrAssistantTask(tasks, pr), [pr, tasks]);
  const [starting, setStarting] = React.useState<PrAssistantIntent | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Fetched on the first question, not on tab open. Shares the Diff tab's key.
  const [wantDiff, setWantDiff] = React.useState(false);
  const diffQuery = useQuery({
    queryKey: ["pull", "diff", pr.project, pr.number, "", ""],
    queryFn: () => daemon.pullDiff(pr.project, pr.number, null),
    enabled: wantDiff,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // The harness is the user's pick, remembered; the first configured one is
  // only the default. Auto-picking with no control is what shipped first.
  const pickedAgentId = useUi((s) => s.prAssistantAgentId);
  const setPickedAgentId = useUi((s) => s.setPrAssistantAgentId);
  const usable = React.useMemo(
    () => agents.filter((candidate) => candidate.enabled !== false),
    [agents],
  );
  const agentConfig = React.useMemo(() => {
    const picked = usable.find((candidate) => candidate.id === pickedAgentId);
    return picked ?? usable[0] ?? agents[0] ?? null;
  }, [agents, pickedAgentId, usable]);
  const agent = agentConfig?.id ?? null;
  const agentLabel = agentConfig?.displayName || agent || "no agent";

  // Which model answers. `lastModel` is the harness's own default; a pick here
  // is remembered per harness and travels as the task's `default_model`.
  const modelPicks = useUi((s) => s.prAssistantModelByAgent);
  const setModelPick = useUi((s) => s.setPrAssistantModel);
  const modelOption = React.useMemo<ConfigOption | null>(
    () => agentConfig?.models.find((option) => configRole(option) === "model") ?? null,
    [agentConfig],
  );
  const model = agent
    ? (modelPicks[agent] ?? agentConfig?.lastModel ?? modelOption?.currentValue ?? null)
    : null;
  const modelLabel =
    modelOption?.options.find((choice) => choice.value === model)?.name ?? model ?? null;

  const ask = React.useCallback(
    async (intent: PrAssistantIntent) => {
      if (starting) return;
      setWantDiff(true);
      setStarting(intent);
      setError(null);
      try {
        // Worth waiting for, not worth failing over.
        const diff = await diffQuery.refetch().then(
          (result) => result.data ?? null,
          () => null,
        );
        const prompt = prAssistantPrompt({ details, diff, intent, pr });
        if (task) {
          await daemon.request("session.prompt", { task_id: task.id, text: prompt });
          return;
        }
        if (!agent) throw new Error("no agent is configured yet");
        await daemon.taskCreate({
          agent,
          defaultModel: model ?? undefined,
          includeRuntimeContext: false,
          origin: PR_REVIEW_ORIGIN,
          project: pr.project,
          prompt,
          tags: [PR_REVIEW_ORIGIN, prTaskTag(pr)],
          worktree: false,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setStarting(null);
      }
    },
    [agent, details, diffQuery, model, pr, starting, task],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/70 px-2">
        {/* The harness a live conversation runs on cannot change under it, so
            the picker becomes a label once there is a task. */}
        {task ? (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {agent && <AgentLogo agentId={agent} displayName={agentLabel} className="size-3.5" />}
            <span className="truncate">{agentLabel}</span>
            {modelLabel && <span className="truncate text-muted-foreground/60">{modelLabel}</span>}
          </span>
        ) : (
          <>
            <PickerMenu
              label={agentLabel}
              title="Which agent answers"
              disabled={usable.length < 2}
              icon={
                agent ? (
                  <AgentLogo agentId={agent} displayName={agentLabel} className="size-3.5" />
                ) : undefined
              }
              items={usable.map((candidate) => ({
                icon: (
                  <AgentLogo
                    agentId={candidate.id}
                    displayName={candidate.displayName || candidate.id}
                    className="size-3.5"
                  />
                ),
                label: candidate.displayName || candidate.id,
                onSelect: () => setPickedAgentId(candidate.id),
                selected: candidate.id === agent,
              }))}
            />
            {modelOption && agent && modelOption.options.length > 0 && (
              <PickerMenu
                label={modelLabel ?? "default model"}
                title="Which model answers"
                items={modelOption.options.map((choice) => ({
                  label: choice.name || choice.value,
                  onSelect: () => setModelPick(agent, choice.value),
                  selected: choice.value === model,
                }))}
              />
            )}
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* Both answer in this tab. Everything that turns the pull request
              into a task of its own lives under "Send to agent" instead, so
              the two are never a row of look-alike buttons. */}
          <IntentButton
            icon={Sparkles}
            label="Explain"
            title="Walks you through the change, here in this tab"
            busy={starting === "explain"}
            disabled={!!starting || (!task && !agent)}
            onClick={() => void ask("explain")}
          />
          <IntentButton
            icon={MessageSquareCode}
            label="Review"
            title="Looks for what is wrong with the change, here in this tab"
            busy={starting === "review"}
            disabled={!!starting || (!task && !agent)}
            onClick={() => void ask("review")}
          />
        </div>
      </div>

      {error && <p className="shrink-0 px-3 py-2 text-xs text-destructive">{error}</p>}

      {task ? (
        <AssistantThread task={task} agents={agents} />
      ) : (
        <EmptyState agent={agent} starting={!!starting} />
      )}
    </div>
  );
}

function EmptyState({ agent, starting }: { agent: string | null; starting: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <Bot aria-hidden className="size-6 text-muted-foreground/30" />
      {agent ? (
        <>
          <p className="max-w-sm text-sm text-muted-foreground">
            Ask an agent about this pull request. <strong className="font-medium">Explain</strong>{" "}
            walks the change; <strong className="font-medium">Review</strong> looks for what is
            wrong with it. Both continue in the same conversation.
          </p>
          {starting && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Reading the pull request…
            </span>
          )}
        </>
      ) : (
        <p className="max-w-sm text-sm text-muted-foreground">
          Add an agent in Settings to ask about this pull request.
        </p>
      )}
    </div>
  );
}

function AssistantThread({ task, agents }: { task: TaskInfo; agents: readonly AgentConfig[] }) {
  const updates = useTaskSessionUpdates(task.id);
  const activity = React.useMemo(() => sessionActivity(task, updates), [task, updates]);
  const composerRef = React.useRef<ComposerHandle>(null);
  const openTask = useUi((s) => s.openTask);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatTranscript
        key={task.id}
        active
        activity={activity}
        agents={agents as AgentConfig[]}
        commands={[]}
        composerRef={composerRef}
        files={[]}
        filesLoading={false}
        imageSupported={false}
        onOpenFile={() => {}}
        onOpenFileDiff={() => {}}
        onOpenTask={openTask}
        resolveFilePath={() => null}
        task={task}
        updates={updates}
      />
    </div>
  );
}
