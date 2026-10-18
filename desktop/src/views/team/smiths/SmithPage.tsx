import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pause, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SmithAvatar } from "@/components/SmithAvatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { daemon } from "@/daemon";
import { useMarkSmithSeen } from "@/hooks/useSmiths";
import { smithStatus, smithWorkSessions } from "@/lib/smiths";
import type { Smith, SmithDetail, Snapshot } from "@/protocol";
import { useUi } from "@/store/ui";

import { HeldBanner } from "./HeldBanner";
import { smithDetailKey } from "./queries";
import { SmithChat } from "./SmithChat";
import { SmithSettings } from "./SmithSettings";
import { SmithStatusBadge } from "./SmithStatusBadge";
import { SmithWork } from "./SmithWork";

type Tab = "chat" | "work" | "settings";

interface Props {
  smith: Smith;
  snapshot: Snapshot;
  tab?: Tab;
  onOpenTask: (id: string) => void;
  onDeleted: () => void;
}

/** What deleting does (ADR 0027), said before the user confirms. */
const DELETE_EXPLAINED =
  "Its conversation is archived and its soul and charter are set aside on disk. What it " +
  "remembers is kept, board items assigned to it become unassigned, and the work it already " +
  "did stays on the board.";

/**
 * A Smith's page: Chat with it (the default), its Work, and its Settings.
 * Pause and Delete live in the "⋯" menu.
 */
export function SmithPage({ smith, snapshot, tab = "chat", onOpenTask, onDeleted }: Props) {
  const queryClient = useQueryClient();
  const openTeam = useUi((state) => state.openTeam);
  useMarkSmithSeen(smith);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const status = smithStatus(smith, snapshot.tasks);
  const openWork = smithWorkSessions(smith, snapshot.tasks).length;
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
      className="mx-auto flex min-h-0 w-full min-w-0 max-w-[920px] flex-1 flex-col px-8 pt-6"
    >
      <header className="flex items-center gap-3.5">
        <SmithAvatar smith={smith} size="size-10" className="[&>span]:text-base" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold leading-tight">{smith.name}</h2>
            <SmithStatusBadge status={status} />
          </div>
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
            {smith.homeProject}
            {smith.allowedProjects.length > 1 && ` +${smith.allowedProjects.length - 1}`} ·{" "}
            {smith.agent}
            {smith.model ? ` · ${smith.model}` : ""}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="More"
              className="ml-auto size-8"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-[13px]"
              onSelect={() =>
                void run(paused ? "Could not resume" : "Could not pause", () =>
                  daemon.setSmithPaused(smith.id, !paused),
                )
              }
            >
              {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {paused ? "Resume" : "Pause"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-[13px] text-destructive"
              onSelect={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-3.5" />
              Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <Tabs
        value={tab}
        onValueChange={(next) => openTeam({ id: smith.id, kind: "teammate", tab: next as Tab })}
        className="mt-5 border-b border-border"
      >
        <TabsList className="gap-6">
          <TabsTrigger value="chat" className="-mb-px px-0">
            Chat
          </TabsTrigger>
          <TabsTrigger value="work" className="-mb-px px-0">
            Work
            {openWork > 0 && (
              <span className="tnum text-[11px] text-muted-foreground">{openWork}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="settings" className="-mb-px px-0">
            Settings
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <HeldBanner smith={smith} onResolved={resolved} />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-6">
        {tab === "chat" && <SmithChat smith={smith} snapshot={snapshot} onOpenTask={onOpenTask} />}
        {tab === "work" && <SmithWork smith={smith} snapshot={snapshot} onOpenTask={onOpenTask} />}
        {tab === "settings" && <SmithSettings smithId={smith.id} snapshot={snapshot} />}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this smith?"
        description={DELETE_EXPLAINED}
        confirmLabel="Delete smith"
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
