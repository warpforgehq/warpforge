import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { smithStatus } from "@/lib/smiths";
import { cn } from "@/lib/utils";
import type { Smith, TaskInfo } from "@/protocol";

import { SmithStatusBadge } from "./SmithStatusBadge";

interface Props {
  smiths: Smith[];
  tasks: TaskInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

/** The Teammates column: every Smith with its home project and status. */
export function TeammateList({ smiths, tasks, selectedId, onSelect, onNew }: Props) {
  return (
    <nav aria-label="Teammates" className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto">
      <Button type="button" variant="outline" size="sm" onClick={onNew}>
        <Plus className="size-3.5" />
        New teammate
      </Button>
      {smiths.length === 0 && (
        <p className="px-2 text-[13px] text-muted-foreground">
          No teammates yet. A teammate keeps its name, voice and memory across tasks.
        </p>
      )}
      {smiths.map((smith) => (
        <button
          key={smith.id}
          type="button"
          aria-current={smith.id === selectedId ? "true" : undefined}
          onClick={() => onSelect(smith.id)}
          className={cn(
            "flex w-full min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent/60",
            smith.id === selectedId && "bg-accent",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{smith.name}</span>
            <span className="ml-auto shrink-0">
              <SmithStatusBadge status={smithStatus(smith, tasks)} />
            </span>
          </span>
          <span className="truncate text-xs text-muted-foreground">{smith.homeProject}</span>
        </button>
      ))}
    </nav>
  );
}
