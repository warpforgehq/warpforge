import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { daemon } from "@/daemon";
import { useSmiths } from "@/hooks/useSmiths";
import type { Channel } from "@/protocol";
import { usePeersStore } from "@/store/peers";
import { useUi } from "@/store/ui";

import { ChannelNameDialog } from "./ChannelNameDialog";

/** Its posts stay in the feed (ADR 0026 addendum), said before confirming. */
const DELETE_EXPLAINED =
  "Its Smiths stop reading it and it leaves the sidebar. Its posts are kept, but no session receives them again.";

async function apply(what: string, run: () => Promise<Channel | void>) {
  try {
    const channel = await run();
    if (channel) usePeersStore.getState().upsertChannel(channel);
  } catch (error) {
    toast.error(what, { description: error instanceof Error ? error.message : String(error) });
  }
}

/** A named channel's members (Smiths) and the user's controls over it. */
export function ChannelControls({ channel }: { channel: Channel }) {
  const smiths = useSmiths();
  const channels = usePeersStore((state) => state.channels);
  const openTeam = useUi((state) => state.openTeam);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const memberIds = new Set(channel.members.map((m) => m.smithId));
  const addable = smiths.filter(
    (smith) => !memberIds.has(smith.id) && smith.allowedProjects.includes(channel.project),
  );

  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 pt-1 text-xs">
      <span className="text-muted-foreground">Members:</span>
      {channel.members.length === 0 && <span className="text-muted-foreground">no Smiths yet</span>}
      {channel.members.map((member) => (
        <span
          key={member.smithId}
          className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5"
        >
          {member.name}
          <button
            type="button"
            aria-label={`Remove ${member.name}`}
            className="text-muted-foreground hover:text-foreground"
            onClick={() =>
              void apply("Could not remove the Smith", () =>
                daemon.removeChannelMember(channel.id, member.smithId),
              )
            }
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {addable.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs">
              <Plus className="size-3" />
              Add smith
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {addable.map((smith) => (
              <DropdownMenuItem
                key={smith.id}
                className="text-[13px]"
                onSelect={() =>
                  void apply("Could not add the Smith", () =>
                    daemon.addChannelMember(channel.id, smith.id),
                  )
                }
              >
                {smith.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <div className="ml-auto flex gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => setRenaming(true)}
        >
          <Pencil className="size-3" />
          Rename
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => setDeleting(true)}
        >
          <Trash2 className="size-3" />
          Delete
        </Button>
      </div>
      {renaming && (
        <ChannelNameDialog
          project={channel.project}
          current={channel.name}
          taken={Object.values(channels)
            .filter((c) => c.project === channel.project)
            .map((c) => c.name)}
          onOpenChange={setRenaming}
          onSave={async (name) => {
            usePeersStore.getState().upsertChannel(await daemon.renameChannel(channel.id, name));
          }}
        />
      )}
      <ConfirmDialog
        open={deleting}
        title={`Delete #${channel.name}?`}
        description={DELETE_EXPLAINED}
        confirmLabel="Delete channel"
        onCancel={() => setDeleting(false)}
        onConfirm={async () => {
          await apply("Could not delete the channel", async () => {
            await daemon.deleteChannel(channel.id);
            usePeersStore.getState().removeChannel(channel.id);
            openTeam(null);
          });
          setDeleting(false);
        }}
      />
    </div>
  );
}
