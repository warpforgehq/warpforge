import { useQueryClient } from "@tanstack/react-query";
import { Pause, Pencil, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { daemon } from "@/daemon";
import { useMarkSmithSeen } from "@/hooks/useSmiths";
import { injectionNote, smithStatus, smithWorkSessions } from "@/lib/smiths";
import { taskLabel } from "@/lib/taskLabel";
import type { BacklogItem, Smith, SmithDetail, Snapshot } from "@/protocol";

import { HeldBanner } from "./HeldBanner";
import { smithDetailKey, useSmithItems } from "./queries";
import { SmithChat } from "./SmithChat";
import { SmithStatusBadge } from "./SmithStatusBadge";
import { StartWorkDialog } from "./StartWorkDialog";

interface Props {
  smith: Smith;
  snapshot: Snapshot;
  onOpenTask: (id: string) => void;
  onEdit: () => void;
  onDeleted: () => void;
}

/** What deleting does (ADR 0027), said before the user confirms. */
const DELETE_EXPLAINED =
  "Its conversation is archived and its soul and charter are set aside on disk. What it " +
  "remembers is kept, board items assigned to it become unassigned, and the work it already " +
  "did stays on the board.";

/**
 * A teammate's page: its status and controls, the conversation with it, its
 * open work and the board items assigned to it.
 */
export function SmithPage({ smith, snapshot, onOpenTask, onEdit, onDeleted }: Props) {
  const queryClient = useQueryClient();
  useMarkSmithSeen(smith);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [starting, setStarting] = useState<{ item: BacklogItem | null } | null>(null);
  const status = smithStatus(smith, snapshot.tasks);
  const sessions = smithWorkSessions(smith, snapshot.tasks);
  const { items, loading } = useSmithItems(smith);
  const paused = smith.held?.includes("paused") ?? false;

  const run = async (what: string, action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      toast.error(what, { description: error instanceof Error ? error.message : String(error) });
    }
  };

  const resolved = (detail: SmithDetail) =>
    queryClient.setQueryData(smithDetailKey(smith.id), detail);

  return (
    <section
      aria-label={smith.name}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{smith.name}</h2>
        <SmithStatusBadge status={status} />
        <span className="text-[13px] text-muted-foreground">
          {smith.homeProject}
          {smith.allowedProjects.length > 1 && ` +${smith.allowedProjects.length - 1}`} ·{" "}
          {smith.agent}
          {smith.model ? ` · ${smith.model}` : ""}
        </span>
        <div className="ml-auto flex flex-wrap gap-1">
          <Button type="button" size="sm" onClick={() => setStarting({ item: null })}>
            <Play className="size-3.5" />
            Start work
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="size-3.5" />
            Edit
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              void run(paused ? "Could not resume" : "Could not pause", () =>
                daemon.setSmithPaused(smith.id, !paused),
              )
            }
          >
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </div>
      </header>

      {injectionNote(smith) && (
        <p className="-mt-2 text-xs text-muted-foreground">{injectionNote(smith)}</p>
      )}

      <HeldBanner smith={smith} onResolved={resolved} />

      <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex h-[65vh] min-h-[24rem] min-w-0 flex-col">
          <SmithChat smith={smith} snapshot={snapshot} onOpenTask={onOpenTask} />
        </div>
        <aside className="space-y-4 text-[13px]">
          <section aria-label="Open work" className="space-y-1">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Open work
            </h3>
            {sessions.length === 0 && <p className="text-muted-foreground">Nothing open.</p>}
            {sessions.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpenTask(task.id)}
                className="block w-full truncate rounded px-1 py-0.5 text-left hover:bg-accent/60"
              >
                {taskLabel(task).split("\n")[0]}
                <span className="ml-1 text-xs text-muted-foreground">{task.status}</span>
              </button>
            ))}
          </section>
          <section aria-label="Assigned on the board" className="space-y-1">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Assigned on the board
            </h3>
            {loading && <p className="text-muted-foreground">Loading…</p>}
            {!loading && items.length === 0 && (
              <p className="text-muted-foreground">No board items assigned.</p>
            )}
            {items.map((item) => (
              <div key={item.id} className="flex min-w-0 items-center gap-1">
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-muted-foreground">#{item.number}</span> {item.title}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 shrink-0 px-2 text-xs"
                  onClick={() => setStarting({ item })}
                >
                  Start
                </Button>
              </div>
            ))}
          </section>
        </aside>
      </div>

      {starting && (
        <StartWorkDialog
          open
          smith={smith}
          items={items}
          item={starting.item}
          onOpenChange={(open) => !open && setStarting(null)}
          onStarted={onOpenTask}
        />
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${smith.name}?`}
        description={DELETE_EXPLAINED}
        confirmLabel="Delete teammate"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await run("Could not delete", async () => {
            await daemon.deleteSmith(smith.id);
            onDeleted();
          });
          setConfirmDelete(false);
        }}
      />
    </section>
  );
}
