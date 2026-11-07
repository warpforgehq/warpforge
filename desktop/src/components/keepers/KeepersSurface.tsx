import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import { daemon } from "@/daemon";
import { DaemonRpcError } from "@/daemon/rpcError";
import { useTaskKeepers } from "@/hooks/useTaskKeepers";
import { type KeeperPresetId, readyKeepers } from "@/lib/keepers";
import type { KeeperEntry, TaskInfo } from "@/protocol";

import { AddKeeper } from "./AddKeeper";
import { KeeperCard, type KeeperActions } from "./KeeperCard";

function failed(what: string) {
  return (cause: unknown) => {
    toast.error(what, {
      description: cause instanceof DaemonRpcError ? cause.detail : String(cause),
    });
  };
}

function CheckBeforePr({ taskId, running }: { taskId: string; running: boolean }) {
  const [asking, setAsking] = useState(false);
  const check = () => {
    setAsking(true);
    void daemon
      .checkReadyKeepers(taskId)
      .catch(failed("Could not check before the pull request"))
      .finally(() => setAsking(false));
  };
  return (
    <Button size="sm" variant="outline" disabled={asking || running} onClick={check}>
      Check before PR
    </Button>
  );
}

function FileProblems({ entries }: { entries: readonly KeeperEntry[] }) {
  const problems = entries.filter((entry) => entry.error || entry.warnings?.length);
  if (problems.length === 0) return null;
  return (
    <ul aria-label="Keeper file problems" className="flex flex-col gap-1 px-3 py-2">
      {problems.map((entry) => (
        <li key={entry.id} className="flex items-start gap-1.5 text-xs">
          <TriangleAlert
            aria-hidden
            className={entry.error ? "size-3.5 text-destructive" : "size-3.5 text-warn"}
          />
          <span className="min-w-0">
            <span className="font-mono">.warpforge/keepers/{entry.id}</span>
            {[entry.error, ...(entry.warnings ?? [])].filter(Boolean).map((line) => (
              <span key={line} className="block text-muted-foreground">
                {line}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The task's Keepers surface: each keeper of the project with its switch,
 * state, last runs and findings, and **Add keeper** for the built-ins.
 * @param task A keeper-eligible task.
 * @param onOpenFile Opens a path at a line in the Explorer.
 * @returns The surface.
 */
export function KeepersSurface({
  task,
  onOpenFile,
}: {
  task: TaskInfo;
  onOpenFile: (path: string, location?: { line?: number }) => void;
}) {
  const queryClient = useQueryClient();
  const state = useTaskKeepers(task.id);
  const list = useQuery({
    queryFn: () => daemon.listKeepers(task.project),
    queryKey: ["keepers", task.project],
  });
  const entries = list.data ?? [];
  const valid = entries.filter((entry) => entry.definition && !entry.error);

  useEffect(() => {
    void daemon.refreshTaskKeepers(task.id).catch(() => {});
  }, [task.id]);

  const add = (preset: KeeperPresetId) => {
    void daemon
      .addKeeper(task.project, preset)
      .then(() => queryClient.invalidateQueries({ queryKey: ["keepers", task.project] }))
      .then(() => daemon.refreshTaskKeepers(task.id))
      .catch(failed("Could not add the keeper"));
  };

  const actions: KeeperActions = {
    onAccept: (findingId) =>
      daemon
        .acceptKeeperReply(task.id, findingId)
        .catch(failed("Could not accept the agent's answer")),
    onDecide: (keeperId, decision, options) =>
      daemon.decideKeeper(task.id, keeperId, decision, options).catch(failed("Could not answer")),
    onDismiss: (findingId, reason) =>
      daemon
        .dismissKeeperFinding(task.id, findingId, reason)
        .catch(failed("Could not dismiss the finding")),
    onOpenFile,
    onSend: (keeperId) =>
      daemon.sendKeeperFindings(task.id, keeperId).catch(failed("Could not send the findings")),
    onSwitch: (keeperId, on) =>
      daemon.setKeeperSwitch(task.id, keeperId, on).catch(failed("Could not switch the keeper")),
  };

  if (list.isPending) {
    return <p className="px-3 py-3 text-xs text-muted-foreground">Loading keepers…</p>;
  }
  if (list.isError) {
    return (
      <EmptyState
        icon={TriangleAlert}
        title="Keepers could not be read"
        hint={String(list.error)}
        action={
          <Button size="sm" variant="outline" onClick={() => void list.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No keepers yet"
        hint="A keeper is an agent that checks every commit and asks the task's agent to fix what it finds. Keepers belong to the project: one you add here checks every task, and its switch turns it off for one task only."
        action={<AddKeeper entries={entries} onAdd={add} />}
      />
    );
  }
  const ready = readyKeepers(valid, state);
  const branch = state?.switches.branch;
  const held = state?.switches.held;
  return (
    <ScrollArea className="h-full">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 text-xs">
          <p className="text-muted-foreground">
            {branch && !task.worktree
              ? `Checks each commit on ${branch}.`
              : "Checks each commit on this task's branch."}
          </p>
          {held ? <p className="text-warn">Paused: {held}.</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {ready.length > 0 && (
            <CheckBeforePr taskId={task.id} running={ready.some((keeper) => keeper.running)} />
          )}
          <AddKeeper entries={entries} onAdd={add} />
        </div>
      </div>
      <FileProblems entries={entries} />
      {valid.map((entry) => (
        <KeeperCard key={entry.id} entry={entry} state={state} {...actions} />
      ))}
    </ScrollArea>
  );
}
