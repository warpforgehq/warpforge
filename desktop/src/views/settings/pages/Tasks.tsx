import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import { daemon } from "@/daemon";
import { configRole } from "@/lib/configRole";
import { usePickerAgents, usePickerOptions } from "@/lib/pickerPreferences";
import type { HistorySettings } from "@/protocol";
import { useUi } from "@/store/ui";

import {
  settingsControl,
  SettingsNote,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  Toggle,
} from "../primitives";
import { Confirmations } from "./Confirmations";

/** The three retention windows as one sentence, so the chain they form is
 *  readable without holding three rows in your head. */
function lifecycleSentence(settle: number, keep: number, remove: number): string {
  const parts = [
    settle ? `settles after ${settle} days` : "never settles on its own",
    keep ? `loses its chat after ${keep} days` : "keeps its chat forever",
    remove ? `is deleted after ${remove} days` : "is never deleted",
  ];
  return `Left alone, a finished task ${parts[0]}, ${parts[1]}, and ${parts[2]}.`;
}

export default function TasksPage() {
  const queryClient = useQueryClient();
  const state = useSyncExternalStore(daemon.subscribe, daemon.getState);

  const autoNameTasks = useUi((s) => s.autoNameTasks);
  const setAutoNameTasks = useUi((s) => s.setAutoNameTasks);
  const textGenAgentId = useUi((s) => s.textGenAgentId);
  const setTextGenAgentId = useUi((s) => s.setTextGenAgentId);
  const textGenModel = useUi((s) => s.textGenModel);
  const setTextGenModel = useUi((s) => s.setTextGenModel);

  const enabledAgents = usePickerAgents(state.snapshot.agents);
  const configuredAgent = state.snapshot.agents?.find((agent) => agent.id === textGenAgentId);
  const modelOption = usePickerOptions(textGenAgentId, configuredAgent?.models).find(
    (o) => configRole(o) === "model",
  );

  const historySettings = useQuery({
    queryKey: ["history", "settings"],
    queryFn: () => daemon.historySettings(),
  });
  /** Change the retention windows. The daemon sweeps immediately on success;
   *  deletions themselves are announced by the daemon's history.pruned and
   *  history.swept toasts. */
  const applyRetention = useMutation({
    mutationFn: (patch: Partial<HistorySettings>) =>
      daemon.setHistorySettings({
        retentionDays: 30,
        settleIgnoredAfterDays: 14,
        deleteClosedAfterDays: 90,
        ...historySettings.data,
        ...patch,
      }),
    onSuccess: (settings) => queryClient.setQueryData(["history", "settings"], settings),
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  return (
    <SettingsPage page="tasks">
      <Confirmations />
      <SettingsSection title="Text generation">
        <SettingsRow
          id="auto-name-tasks"
          title="Auto-name tasks"
          description="Give a new task a short title, written by the agent below."
          hint="Runs once, right after the task is created. Uses the agent and model picked below."
          control={
            <Toggle
              id="auto-name-tasks-switch"
              label="Auto-name tasks"
              checked={autoNameTasks}
              onChange={setAutoNameTasks}
            />
          }
        />
        <SettingsRow
          id="text-gen-agent"
          title="Agent for git text"
          description="Drafts commit messages and PR descriptions from the diff."
          hint="On demand, never automatically. The same agent is used for both."
          control={
            <select
              aria-label="Agent for git text"
              value={textGenAgentId ?? ""}
              onChange={(e) => setTextGenAgentId(e.target.value || null)}
              className={settingsControl}
            >
              <option value="">None</option>
              {textGenAgentId && !enabledAgents.some((agent) => agent.id === textGenAgentId) && (
                <option disabled value={textGenAgentId}>
                  {configuredAgent?.displayName ?? textGenAgentId}
                </option>
              )}
              {enabledAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
            </select>
          }
        />
        <SettingsRow
          id="text-gen-model"
          title="Model for git text"
          description="Choose the model that drafts task titles and git text."
          control={
            <select
              aria-label="Model for git text"
              value={textGenModel ?? ""}
              onChange={(e) => setTextGenModel(e.target.value || null)}
              disabled={!modelOption && !textGenModel}
              className={`${settingsControl} max-w-56`}
            >
              <option value="">Agent default</option>
              {textGenModel && !modelOption?.options.some((o) => o.value === textGenModel) && (
                <option disabled value={textGenModel}>
                  {textGenModel}
                </option>
              )}
              {modelOption?.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.name}
                </option>
              ))}
            </select>
          }
        />
      </SettingsSection>

      <SettingsSection title="Task history">
        <SettingsRow
          id="transcript-retention"
          title="Keep transcripts for"
          description="How long a closed task keeps its conversation."
          hint="Afterwards the task still shows its title, prompt and diff — only the chat is gone. Pruning runs at startup, once a day, and right after you change this, with a notice each time it deletes something."
          control={
            <select
              aria-label="Transcript retention"
              value={historySettings.data?.retentionDays ?? 30}
              disabled={historySettings.isLoading || applyRetention.isPending}
              onChange={(event) =>
                applyRetention.mutate({ retentionDays: Number(event.target.value) })
              }
              className={settingsControl}
            >
              <option value={15}>15 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={0}>Forever</option>
            </select>
          }
        />
        <SettingsRow
          id="auto-settle"
          title="Settle ignored tasks after"
          description="An untouched finished turn closes itself."
          hint="Only turns that produced no changes. A task with changes is never settled automatically. Off disables it."
          control={
            <select
              aria-label="Auto-settle ignored tasks"
              value={historySettings.data?.settleIgnoredAfterDays ?? 14}
              disabled={historySettings.isLoading || applyRetention.isPending}
              onChange={(event) =>
                applyRetention.mutate({ settleIgnoredAfterDays: Number(event.target.value) })
              }
              className={settingsControl}
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={0}>Off</option>
            </select>
          }
        />
        <SettingsRow
          id="closed-task-expiry"
          title="Delete closed tasks after"
          description="Removes the task, its chat and its worktree."
          hint="Commits stay in git. A task with unmerged changes is kept regardless. Forever disables it."
          control={
            <select
              aria-label="Closed task expiry"
              value={historySettings.data?.deleteClosedAfterDays ?? 90}
              disabled={historySettings.isLoading || applyRetention.isPending}
              onChange={(event) =>
                applyRetention.mutate({ deleteClosedAfterDays: Number(event.target.value) })
              }
              className={settingsControl}
            >
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={0}>Forever</option>
            </select>
          }
        />
        <SettingsNote>
          {lifecycleSentence(
            historySettings.data?.settleIgnoredAfterDays ?? 14,
            historySettings.data?.retentionDays ?? 30,
            historySettings.data?.deleteClosedAfterDays ?? 90,
          )}
        </SettingsNote>
      </SettingsSection>
    </SettingsPage>
  );
}
