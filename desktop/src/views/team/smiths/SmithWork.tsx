import { Play } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { smithWorkSessions } from "@/lib/smiths";
import { taskLabel } from "@/lib/taskLabel";
import type { BacklogItem, Smith, Snapshot } from "@/protocol";

import { useSmithItems } from "./queries";
import { StartWorkDialog } from "./StartWorkDialog";

/** The Smith page's Work tab: what it is working on and what is on its
 *  plate on the board, with Start work. */
export function SmithWork({
  smith,
  snapshot,
  onOpenTask,
}: {
  smith: Smith;
  snapshot: Snapshot;
  onOpenTask: (id: string) => void;
}) {
  const [starting, setStarting] = useState<{ item: BacklogItem | null } | null>(null);
  const sessions = smithWorkSessions(smith, snapshot.tasks);
  const { items, loading } = useSmithItems(smith);
  return (
    <div className="space-y-5 pb-4 text-[13px]">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground">
          Work runs as a normal task on the board, with {smith.name}'s soul and memory.
        </p>
        <Button type="button" size="sm" onClick={() => setStarting({ item: null })}>
          <Play className="size-3.5" />
          Start work
        </Button>
      </div>

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
            className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/60"
          >
            <span className="min-w-0 flex-1 truncate">{taskLabel(task).split("\n")[0]}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{task.project}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{task.status}</span>
          </button>
        ))}
      </section>

      <section aria-label="Assigned on the board" className="space-y-1">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Assigned on the board
        </h3>
        {loading && <p className="text-muted-foreground">Loading…</p>}
        {!loading && items.length === 0 && (
          <p className="text-muted-foreground">
            No board items assigned. Assign a local item to {smith.name} from the board.
          </p>
        )}
        {items.map((item) => (
          <div key={item.id} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1">
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
    </div>
  );
}
