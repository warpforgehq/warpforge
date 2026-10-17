import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import { useSmiths } from "@/hooks/useSmiths";
import type { SmithDetail, Snapshot } from "@/protocol";
import { useSmithsStore } from "@/store/smiths";

import { emptySmithForm, smithFormFrom } from "./form";
import { smithDetailKey, useSmithDetail } from "./queries";
import { SmithForm } from "./SmithForm";
import { SmithPage } from "./SmithPage";
import { TeammateList } from "./TeammateList";

type Panel = { kind: "view"; id: string } | { kind: "edit"; id: string } | { kind: "new" };

interface Props {
  snapshot: Snapshot;
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

/** Team's Teammates area: the Smiths, one teammate's page, and the form that
 *  creates or edits one. */
export function Teammates({ snapshot, onOpenTask }: Props) {
  const queryClient = useQueryClient();
  const smiths = useSmiths();
  const byId = useSmithsStore((state) => state.smiths);
  const [panel, setPanel] = useState<Panel | null>(null);
  const current = panel ?? (smiths[0] ? { id: smiths[0].id, kind: "view" as const } : null);
  const shown = current && current.kind !== "new" ? byId[current.id] : undefined;

  const saved = (detail?: SmithDetail) => {
    if (detail) {
      queryClient.setQueryData(smithDetailKey(detail.smith.id), detail);
      useSmithsStore.getState().upsert(detail.smith);
      setPanel({ id: detail.smith.id, kind: "view" });
    } else {
      setPanel(current?.kind === "edit" ? { id: current.id, kind: "view" } : null);
    }
  };

  const defaults = {
    agent: (snapshot.agents ?? []).find((agent) => agent.enabled)?.id ?? "claude",
    project: snapshot.projects[0]?.name ?? "",
  };

  return (
    <div className="flex min-h-0 flex-1 gap-3 px-1 pb-2">
      <TeammateList
        smiths={smiths}
        tasks={snapshot.tasks}
        selectedId={shown?.id ?? null}
        onSelect={(id) => setPanel({ id, kind: "view" })}
        onNew={() => setPanel({ kind: "new" })}
      />
      {current?.kind === "new" ? (
        <SmithForm
          snapshot={snapshot}
          initial={emptySmithForm(defaults)}
          smiths={smiths}
          onSaved={saved}
          onCancel={() => setPanel(null)}
        />
      ) : current?.kind === "edit" && shown ? (
        <EditSmith key={shown.id} id={shown.id} snapshot={snapshot} onDone={saved} />
      ) : shown ? (
        <SmithPage
          key={shown.id}
          smith={shown}
          snapshot={snapshot}
          onOpenTask={onOpenTask}
          onEdit={() => setPanel({ id: shown.id, kind: "edit" })}
          onDeleted={() => setPanel(null)}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
          Create a teammate to hand it work by name.
        </div>
      )}
    </div>
  );
}
