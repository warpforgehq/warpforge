import { useQuery } from "@tanstack/react-query";
import { Brain } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { daemon } from "@/daemon";
import type { Memory as MemoryItem, Snapshot } from "@/protocol";

import { MemoryBrowser } from "./memory/MemoryBrowser";
import { MemoryDetail } from "./memory/MemoryDetail";
import { Proposals } from "./memory/Proposals";
import { useMemoryIndex, useMemoryProposals } from "./memory/queries";

type Tab = "memories" | "proposals";

interface Props {
  snapshot: Snapshot;
  onOpenTask: (id: string) => void;
  /** Replaces the title block, for a host that already names the screen. */
  header?: ReactNode;
}

/**
 * The Memory screen: browse and search what agents have saved, edit or delete
 * it, see how memories link, and review dreaming proposals.
 */
export default function Memory({ snapshot, onOpenTask, header }: Props) {
  const [tab, setTab] = useState<Tab>("memories");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<MemoryItem[]>([]);
  const stats = useQuery({ queryFn: () => daemon.memoryStats(), queryKey: ["memory", "stats"] });
  const index = useMemoryIndex(tab === "proposals" || selectedId !== null);
  const proposals = useMemoryProposals();
  const pending = (proposals.data ?? []).filter((p) => p.status === "pending").length;

  const selected = selectedId
    ? (items.find((m) => m.id === selectedId) ?? index.get(selectedId))
    : undefined;
  const open = useCallback((id: string) => {
    setSelectedId(id);
    setTab("memories");
  }, []);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-x-4 gap-y-2 px-1 pb-3 pt-2">
        {header ?? (
          <div className="min-w-0 space-y-1.5">
            <h1 className="truncate text-xl font-semibold leading-none tracking-tight">Memory</h1>
            <p className="truncate text-[13px] text-muted-foreground">
              {stats.data
                ? `${stats.data.globalCount} global, ${stats.data.projectCount} project. `
                : ""}
              What agents remember across tasks.
            </p>
          </div>
        )}
        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
          <TabsList>
            <TabsTrigger variant="pill" value="memories">
              Memories
            </TabsTrigger>
            <TabsTrigger variant="pill" value="proposals">
              Proposals
              {pending > 0 && <span className="tnum text-[11px] text-warn">{pending}</span>}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      <div className="flex min-h-0 flex-1 gap-3 px-1 pb-2">
        {tab === "proposals" ? (
          <Proposals index={index} onOpenMemory={open} />
        ) : (
          <>
            <MemoryBrowser
              selectedId={selectedId}
              onSelect={setSelectedId}
              hybrid={stats.data?.embeddingMode === "hybrid"}
              onItems={setItems}
            />
            <section
              aria-label="Memory detail"
              className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-md border p-4"
            >
              {selected ? (
                <MemoryDetail
                  key={`${selected.id}:${selected.updatedAt}`}
                  memory={selected}
                  index={index}
                  tasks={snapshot.tasks}
                  onSelect={setSelectedId}
                  onDeleted={() => setSelectedId(null)}
                  onOpenTask={onOpenTask}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[13px] text-muted-foreground">
                  <Brain aria-hidden className="size-5" />
                  Select a memory to read, edit or link it.
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
