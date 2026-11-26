import { useQueryClient } from "@tanstack/react-query";
import { List, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { daemon } from "@/daemon";
import {
  automationRunsKey,
  useAutomationEvents,
  useAutomationHistory,
  useAutomationRuns,
  useAutomationsQuery,
  useTicker,
} from "@/hooks/useAutomations";
import type { Automation, AutomationRun, Snapshot } from "@/protocol";
import { useUi } from "@/store/ui";

import { AutomationDetail } from "./automations/AutomationDetail";
import { AutomationDialog } from "./automations/AutomationDialog";
import { AutomationList } from "./automations/AutomationList";
import { AutomationLiveStrip } from "./automations/AutomationLiveStrip";
import { RunOutputDialog } from "./automations/RunOutputDialog";

interface Props {
  snapshot: Snapshot;
  onOpenTask: (id: string) => void;
  listInSidebar: boolean;
}

export default function Automations({ onOpenTask, snapshot, listInSidebar }: Props) {
  const queryClient = useQueryClient();
  useAutomationEvents();
  const now = useTicker();
  const query = useAutomationsQuery();
  const automations = query.data ?? [];
  const selectedId = useUi((state) => state.selectedAutomationId);
  const selected = automations.find((automation) => automation.id === selectedId);
  const history = useAutomationHistory(selected?.id ?? null);

  const [browsing, setBrowsing] = useState(false);
  const [editing, setEditing] = useState<Automation | "new" | null>(null);
  const [openRun, setOpenRun] = useState<AutomationRun | null>(null);
  const [runningIds, setRunningIds] = useState<string[]>([]);

  const runOutputName =
    automations.find((automation) => automation.id === openRun?.automationId)?.name ?? "Automation";

  async function toggleEnabled(automation: Automation, enabled: boolean) {
    try {
      await daemon.updateAutomation(automation.id, { enabled });
    } catch (error) {
      toast.error(enabled ? "Could not resume the automation" : "Could not pause the automation", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function runNow(automation: Automation) {
    setRunningIds((previous) => [...previous, automation.id]);
    void daemon
      .runAutomationNow(automation.id)
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: automationRunsKey(automation.id) });
        toast.success(`${automation.name} is running now`);
      })
      .catch((error: unknown) => {
        toast.error("Could not start the run", {
          description: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => setRunningIds((previous) => previous.filter((id) => id !== automation.id)));
  }

  async function remove(automation: Automation) {
    await daemon.deleteAutomation(automation.id);
    const ui = useUi.getState();
    if (ui.selectedAutomationId === automation.id) ui.selectAutomation(null);
    toast.success(`${automation.name} deleted`);
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-2 pb-2 pt-3 sm:px-4">
      {!listInSidebar && (
        <Dialog open={browsing} onOpenChange={setBrowsing}>
          <DialogTrigger asChild>
            <Button type="button" size="sm" variant="outline" className="mb-3 w-fit gap-1.5">
              <List className="size-4" aria-hidden />
              Browse automations
            </Button>
          </DialogTrigger>
          <DialogContent aria-describedby={undefined} className="flex h-[min(32rem,80vh)] flex-col">
            <DialogTitle>Automations</DialogTitle>
            <div className="min-h-0 flex-1">
              <AutomationList onNavigate={() => setBrowsing(false)} />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {selected ? (
        <AutomationDetail
          key={selected.id}
          automation={selected}
          agents={snapshot.agents ?? []}
          runs={history.data ?? []}
          loadingRuns={history.isLoading}
          runsFailed={history.isError}
          now={now}
          running={runningIds.includes(selected.id)}
          onEdit={setEditing}
          onRunNow={runNow}
          onToggleEnabled={(automation, enabled) => void toggleEnabled(automation, enabled)}
          onDelete={remove}
          onOpenTask={onOpenTask}
          onOpenRun={setOpenRun}
        />
      ) : (
        <>
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 pb-3">
            <h1 className="text-xl font-semibold tracking-tight">Automations overview</h1>
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              disabled={snapshot.projects.length === 0}
              title={
                snapshot.projects.length === 0
                  ? "Add a project to schedule an automation"
                  : undefined
              }
              onClick={() => setEditing("new")}
            >
              <Plus className="size-4" aria-hidden />
              New automation
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {query.isLoading ? (
              <p role="status" className="text-sm text-muted-foreground">
                Loading automations…
              </p>
            ) : query.isError ? (
              <p role="alert" className="text-sm text-destructive">
                Could not load automations.
              </p>
            ) : (
              <AutomationOverview automations={automations} now={now} onOpenRun={setOpenRun} />
            )}
          </div>
        </>
      )}

      {editing && (
        <AutomationDialog
          key={editing === "new" ? "new" : editing.id}
          open
          onOpenChange={(next) => !next && setEditing(null)}
          snapshot={snapshot}
          automation={editing === "new" ? null : editing}
          defaultProject={
            editing === "new" ? (snapshot.projects[0]?.name ?? null) : editing.project
          }
        />
      )}

      <RunOutputDialog
        run={openRun}
        automationName={runOutputName}
        onClose={() => setOpenRun(null)}
        onOpenTask={onOpenTask}
      />
    </div>
  );
}

function AutomationOverview({
  automations,
  now,
  onOpenRun,
}: {
  automations: Automation[];
  now: number;
  onOpenRun: (run: AutomationRun) => void;
}) {
  const { byId, loading, failed } = useAutomationRuns(automations.map(({ id }) => id));
  return (
    <AutomationLiveStrip
      automations={automations}
      runsById={byId}
      loading={loading}
      failed={failed}
      now={now}
      onOpenRun={onOpenRun}
    />
  );
}
