import { Loader2, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { useState } from "react";

import { AgentLogo } from "@/components/AgentLogo";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { agentDisplayName } from "@/lib/agentNames";
import { countdown, describeSchedule, runtimeTimezone } from "@/lib/automationSchedule";
import { cn } from "@/lib/utils";
import type { AgentConfig, Automation, AutomationRun } from "@/protocol";

import { modelLabel, RUN_STATUS_META } from "./labels";

interface Props {
  automation: Automation;
  agents: AgentConfig[];
  runs: AutomationRun[];
  loadingRuns: boolean;
  runsFailed: boolean;
  now: number;
  running: boolean;
  onEdit: (automation: Automation) => void;
  onRunNow: (automation: Automation) => void;
  onToggleEnabled: (automation: Automation, enabled: boolean) => void;
  onDelete: (automation: Automation) => Promise<void>;
  onOpenTask: (taskId: string) => void;
  onOpenRun: (run: AutomationRun) => void;
}

export function AutomationDetail({
  agents,
  automation,
  now,
  loadingRuns,
  onDelete,
  onEdit,
  onOpenRun,
  onOpenTask,
  onRunNow,
  onToggleEnabled,
  runs,
  runsFailed,
  running,
}: Props) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-rule pb-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{automation.name}</h1>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {describeSchedule(automation.trigger)} · {automation.timezone || runtimeTimezone()} ·{" "}
            {automation.enabled && (automation.nextRunAt ?? 0) > 0
              ? countdown((automation.nextRunAt ?? 0) * 1000, now)
              : automation.enabled
                ? "not scheduled"
                : "paused"}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
          <Fact label="Agent">
            <span className="flex items-center gap-1.5">
              <AgentLogo
                agentId={automation.agent}
                displayName={agentDisplayName(automation.agent)}
                className="size-3.5"
              />
              {agentDisplayName(automation.agent)}
            </span>
          </Fact>
          <Fact label="Model">{modelLabel(agents, automation.agent, automation.model)}</Fact>
          <Fact label="Project">{automation.project}</Fact>
          <Fact label="Cron">
            <code className="font-mono text-[11px]">{automation.trigger.cron}</code>
          </Fact>
          <Fact label="Last run">
            {automation.lastRunAt
              ? new Date(automation.lastRunAt * 1000).toLocaleString()
              : "never"}
          </Fact>
          <Fact label="Missed-run grace">{automation.missedRunGraceMinutes} min</Fact>
          <Fact label="Precheck">
            {automation.precheck ? (
              <code className="font-mono text-[11px]">{automation.precheck}</code>
            ) : (
              "none"
            )}
          </Fact>
          <Fact label="Runs go to">
            {[
              automation.reuseSession ? "one task, every run continues it" : "a new task each run",
              automation.worktree ? "isolated worktree" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Fact>
        </dl>

        <h2 className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Prompt
        </h2>
        <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-md border border-border bg-secondary/25 px-3 py-2 font-mono text-[11px] leading-relaxed">
          {automation.prompt}
        </pre>

        <h2 className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Run history
        </h2>
        {loadingRuns ? (
          <p role="status" className="mt-1.5 text-[13px] text-muted-foreground">
            Loading run history…
          </p>
        ) : runsFailed ? (
          <p role="alert" className="mt-1.5 text-[13px] text-destructive">
            Could not load run history.
          </p>
        ) : runs.length === 0 ? (
          <p className="mt-1.5 text-[13px] text-muted-foreground/80">
            No runs yet. “Run now” starts one without touching the schedule.
          </p>
        ) : (
          <ul className="mt-1.5 divide-y divide-rule rounded-md border border-border">
            {runs.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                onOpenRun={() => onOpenRun(run)}
                onOpenTask={onOpenTask}
              />
            ))}
          </ul>
        )}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-rule pt-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={
            running || automation.lastStatus === "running" || automation.lastStatus === "pending"
          }
          onClick={() => onRunNow(automation)}
          title="Run once now; the next scheduled occurrence is unchanged."
        >
          {running ? (
            <Loader2 aria-hidden className="mr-1 size-3.5 animate-spin" />
          ) : (
            <Play aria-hidden className="mr-1 size-3.5" />
          )}
          Run now
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onToggleEnabled(automation, !automation.enabled)}
        >
          {automation.enabled ? (
            <Pause aria-hidden className="mr-1 size-3.5" />
          ) : (
            <Play aria-hidden className="mr-1 size-3.5" />
          )}
          {automation.enabled ? "Pause" : "Resume"}
        </Button>
        <Button type="button" size="sm" onClick={() => onEdit(automation)}>
          <Pencil aria-hidden className="mr-1 size-3.5" />
          Edit
        </Button>
        <span className="flex-1" />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2 aria-hidden className="mr-1 size-3.5" />
          Delete
        </Button>
      </footer>

      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete ${automation.name}?`}
        description="The schedule and its run history go away. Tasks the runs created stay."
        confirmLabel="Delete"
        busyLabel="Deleting…"
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={async () => {
          await onDelete(automation);
          setConfirmingDelete(false);
        }}
      />
    </>
  );
}

function Fact({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate text-foreground">{children}</dd>
    </div>
  );
}

function RunRow({
  onOpenRun,
  onOpenTask,
  run,
}: {
  onOpenRun: () => void;
  onOpenTask: (taskId: string) => void;
  run: AutomationRun;
}) {
  const meta = RUN_STATUS_META[run.status];
  return (
    <li className="flex items-center gap-2 px-2.5 py-1.5 text-[13px]">
      <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} aria-hidden />
      <button
        type="button"
        onClick={onOpenRun}
        className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        title={meta.hint}
      >
        <span className="tnum shrink-0 text-muted-foreground">#{run.runNumber}</span>
        <span className="shrink-0">{meta.label}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground/80">
          {run.error ?? run.output ?? (run.trigger === "manual" ? "manual" : "scheduled")}
        </span>
        <span className="hidden shrink-0 text-muted-foreground/70 sm:inline">
          {new Date(run.startedAt * 1000).toLocaleString()}
        </span>
      </button>
      {run.taskId && (
        <button
          type="button"
          onClick={() => onOpenTask(run.taskId!)}
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Task
        </button>
      )}
    </li>
  );
}
