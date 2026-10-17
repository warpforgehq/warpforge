import type { Snapshot } from "@/protocol";
import { useSmithsStore } from "@/store/smiths";
import type { TeamSelection } from "@/store/ui";

import { SmithPage } from "./SmithPage";

interface Props {
  selection: Extract<TeamSelection, { kind: "teammate" }>;
  snapshot: Snapshot;
  onSelect: (selection: TeamSelection | null) => void;
  onOpenTask: (id: string) => void;
}

/** The Smiths area's main view for one Smith: its page, on the picked tab. */
export function TeammateMain({ selection, snapshot, onSelect, onOpenTask }: Props) {
  const smith = useSmithsStore((state) => state.smiths[selection.id]);
  if (!smith) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
        This smith is gone.
      </div>
    );
  }
  return (
    <SmithPage
      key={smith.id}
      smith={smith}
      snapshot={snapshot}
      tab={selection.tab}
      onOpenTask={onOpenTask}
      onDeleted={() => onSelect(null)}
    />
  );
}
