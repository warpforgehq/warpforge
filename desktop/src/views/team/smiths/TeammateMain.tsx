import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useMemo } from "react";

import { useSmiths } from "@/hooks/useSmiths";
import type { SmithDetail, Snapshot } from "@/protocol";
import { useSmithsStore } from "@/store/smiths";

import type { TeamSelection } from "../selection";
import { emptySmithForm, smithFormFrom } from "./form";
import { smithDetailKey, useSmithDetail } from "./queries";
import { SmithForm } from "./SmithForm";
import { SmithPage } from "./SmithPage";

interface Props {
  selection: Extract<TeamSelection, { kind: "teammate" | "newTeammate" }>;
  snapshot: Snapshot;
  onSelect: (selection: TeamSelection | null) => void;
  onOpenTask: (id: string) => void;
}

function EditSmith({
  id,
  snapshot,
  onDone,
}: {
  id: string;
  snapshot: Snapshot;
  onDone: (detail?: SmithDetail) => void;
}) {
  const detail = useSmithDetail(id);
  const smiths = useSmiths();
  const initial = useMemo(() => (detail.data ? smithFormFrom(detail.data) : null), [detail.data]);
  if (!detail.data || !initial) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-muted-foreground">
        <Loader2 aria-hidden className="size-3.5 animate-spin" />
        Loading the teammate…
      </div>
    );
  }
  return (
    <SmithForm
      snapshot={snapshot}
      editing={detail.data.smith}
      initial={initial}
      smiths={smiths}
      onSaved={onDone}
      onCancel={() => onDone()}
    />
  );
}

/** The Team view's main area for a teammate: its page, its edit form, or the
 *  form for a new one. */
export function TeammateMain({ selection, snapshot, onSelect, onOpenTask }: Props) {
  const queryClient = useQueryClient();
  const smiths = useSmiths();
  const byId = useSmithsStore((state) => state.smiths);

  const saved = (detail?: SmithDetail) => {
    if (detail) {
      queryClient.setQueryData(smithDetailKey(detail.smith.id), detail);
      useSmithsStore.getState().upsert(detail.smith);
      onSelect({ id: detail.smith.id, kind: "teammate" });
    } else {
      onSelect(selection.kind === "teammate" ? { id: selection.id, kind: "teammate" } : null);
    }
  };

  if (selection.kind === "newTeammate") {
    const defaults = {
      agent: (snapshot.agents ?? []).find((agent) => agent.enabled)?.id ?? "claude",
      project: snapshot.projects[0]?.name ?? "",
    };
    return (
      <SmithForm
        snapshot={snapshot}
        initial={emptySmithForm(defaults)}
        smiths={smiths}
        onSaved={saved}
        onCancel={() => onSelect(null)}
      />
    );
  }
  const smith = byId[selection.id];
  if (!smith) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
        This teammate is gone.
      </div>
    );
  }
  if (selection.editing) {
    return <EditSmith key={smith.id} id={smith.id} snapshot={snapshot} onDone={saved} />;
  }
  return (
    <SmithPage
      key={smith.id}
      smith={smith}
      snapshot={snapshot}
      onOpenTask={onOpenTask}
      onEdit={() => onSelect({ editing: true, id: smith.id, kind: "teammate" })}
      onDeleted={() => onSelect(null)}
    />
  );
}
