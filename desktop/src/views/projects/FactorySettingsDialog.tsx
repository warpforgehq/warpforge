import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { daemon } from "@/daemon";
import { runnerStatusKey, useRunnerStatus } from "@/hooks/useRunner";
import { agentDisplayName } from "@/lib/agentNames";
import { configRole } from "@/lib/configRole";
import { usePickerAgents, usePickerOptions } from "@/lib/pickerPreferences";
import type { AgentConfig, RunLocation, RunnerSettings } from "@/protocol";

const FIELD =
  "bg-deep-surface h-8 w-full rounded-md border px-2 text-[13px] outline-none focus:ring-1 focus:ring-ring disabled:opacity-50";

type LimitKey = "maxConcurrent" | "maxOpenPrs" | "maxPerDay" | "minFreeGb" | "headroomPct";

const LIMITS: { key: LimitKey; label: string; hint: string; min: number; max: number }[] = [
  {
    hint: "Only one of them runs in your project folder.",
    key: "maxConcurrent",
    label: "Tasks at the same time",
    max: 8,
    min: 1,
  },
  {
    hint: "New tasks wait while this many of their draft PRs are open.",
    key: "maxOpenPrs",
    label: "Pause at open draft PRs",
    max: 50,
    min: 1,
  },
  {
    hint: "Factory tasks started in any 24 hours.",
    key: "maxPerDay",
    label: "New tasks per 24 hours",
    max: 200,
    min: 1,
  },
  {
    hint: "New tasks wait below this much free disk. 0 turns it off.",
    key: "minFreeGb",
    label: "Keep at least (GB free)",
    max: 10000,
    min: 0,
  },
  {
    hint: "New tasks wait while an agent's quota use is above this. Out of quota always waits.",
    key: "headroomPct",
    label: "Pause when quota use passes (%)",
    max: 100,
    min: 1,
  },
];

const LOCATIONS: { value: RunLocation; label: string }[] = [
  { label: "Automatic (recommended)", value: "auto" },
  { label: "Background copy", value: "worktree" },
  { label: "Your project folder", value: "checkout" },
];

interface Props {
  project: string | null;
  agents: AgentConfig[];
  onClose: () => void;
}

/**
 * A project's Factory settings: the limits that keep unattended work bounded,
 * and the defaults the New Task dialog starts Factory mode with.
 *
 * @param props.project The project, or null while closed.
 * @param props.agents Every configured agent.
 * @param props.onClose Closes the dialog.
 */
export function FactorySettingsDialog({ project, agents, onClose }: Props) {
  const status = useRunnerStatus(project ?? "");
  return (
    <Dialog open={project !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Factory settings</DialogTitle>
          <DialogDescription>
            Limits apply to Factory tasks that open a PR and to backlog batches. They only hold back
            starting new tasks, never a stage of a task already running.
          </DialogDescription>
        </DialogHeader>
        {project && status.data && (
          <SettingsForm settings={status.data.settings} agents={agents} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm({
  settings,
  agents,
  onClose,
}: {
  settings: RunnerSettings;
  agents: AgentConfig[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const workflows = useQuery({
    queryFn: () => daemon.workflowList(settings.project),
    queryKey: ["workflows", settings.project],
  });
  const enabledAgents = usePickerAgents(agents);
  const reported = agents.find((agent) => agent.id === draft.agent)?.models;
  const modelOption = usePickerOptions(draft.agent, reported).find(
    (option) => configRole(option) === "model",
  );

  const save = async () => {
    setSaving(true);
    try {
      const next = await daemon.runnerUpdateSettings(settings.project, {
        agent: draft.agent,
        headroomPct: draft.headroomPct,
        maxConcurrent: draft.maxConcurrent,
        maxOpenPrs: draft.maxOpenPrs,
        maxPerDay: draft.maxPerDay,
        minFreeGb: draft.minFreeGb,
        model: draft.model ?? "",
        runLocation: draft.runLocation,
        workflow: draft.workflow,
      });
      queryClient.setQueryData(runnerStatusKey(settings.project), next);
      toast.success("Factory settings saved");
      onClose();
    } catch (error) {
      toast.error("Could not save the Factory settings", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {LIMITS.map((limit) => (
          <label key={limit.key} className="flex flex-col gap-1" title={limit.hint}>
            <span className="text-[11px] font-medium text-muted-foreground">{limit.label}</span>
            <input
              type="number"
              aria-label={limit.label}
              min={limit.min}
              max={limit.max}
              value={draft[limit.key]}
              onChange={(event) =>
                setDraft({ ...draft, [limit.key]: Number(event.target.value) || limit.min })
              }
              className={FIELD}
            />
            <span className="text-[11px] text-muted-foreground/70">{limit.hint}</span>
          </label>
        ))}
        <p className="text-[11px] font-medium text-muted-foreground sm:col-span-2">
          Defaults for new Factory tasks
        </p>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[11px] font-medium text-muted-foreground">Template</span>
          <select
            aria-label="Default template"
            value={draft.workflow}
            onChange={(event) => setDraft({ ...draft, workflow: event.target.value })}
            className={FIELD}
          >
            {!(workflows.data ?? []).some((w) => w.id === draft.workflow) && (
              <option value={draft.workflow}>{draft.workflow}</option>
            )}
            {(workflows.data ?? []).map((workflow) => (
              <option key={workflow.id} value={workflow.id} disabled={!workflow.valid}>
                {workflow.name}
                {workflow.stages?.length ? ` — ${workflow.stages.join(" → ")}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Lead agent</span>
          <select
            aria-label="Default lead agent"
            value={draft.agent}
            onChange={(event) => setDraft({ ...draft, agent: event.target.value, model: null })}
            className={FIELD}
          >
            <option value="">First enabled agent</option>
            {draft.agent && !enabledAgents.some((agent) => agent.id === draft.agent) && (
              <option disabled value={draft.agent}>
                {agentDisplayName(draft.agent)}
              </option>
            )}
            {enabledAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agentDisplayName(agent.id, agent.displayName)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Model</span>
          <select
            aria-label="Default model"
            value={draft.model ?? ""}
            disabled={!modelOption}
            onChange={(event) => setDraft({ ...draft, model: event.target.value || null })}
            className={FIELD}
          >
            <option value="">Agent default</option>
            {draft.model &&
              !modelOption?.options.some((option) => option.value === draft.model) && (
                <option disabled value={draft.model}>
                  {draft.model}
                </option>
              )}
            {modelOption?.options.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-[11px] font-medium text-muted-foreground">Where it runs</span>
          <select
            aria-label="Default place to run"
            value={draft.runLocation}
            onChange={(event) =>
              setDraft({ ...draft, runLocation: event.target.value as RunLocation })
            }
            className={FIELD}
          >
            {LOCATIONS.map((location) => (
              <option key={location.value} value={location.value}>
                {location.label}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-muted-foreground/70">
            Automatic runs in your project folder when the task tests the running app, in a
            background copy otherwise.
          </span>
        </label>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}
