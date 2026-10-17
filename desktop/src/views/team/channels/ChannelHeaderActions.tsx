import { MoreHorizontal, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
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
import { daemon } from "@/daemon";
import { useSmiths } from "@/hooks/useSmiths";
import type { Channel, PeerControls } from "@/protocol";
import { usePeersStore } from "@/store/peers";
import { useUi } from "@/store/ui";

import { ChannelNameDialog } from "./ChannelNameDialog";

/** Its posts stay in the feed (ADR 0026 addendum), said before confirming. */
const DELETE_EXPLAINED =
  "Its Smiths stop reading it and it leaves the sidebar. Its posts are kept, but no session receives them again.";

async function apply(what: string, run: () => Promise<Channel | PeerControls | void>) {
  try {
    const result = await run();
    if (result && "members" in result) usePeersStore.getState().upsertChannel(result);
    else if (result && "pausedProjects" in result) usePeersStore.getState().setControls(result);
  } catch (error) {
    toast.error(what, { description: error instanceof Error ? error.message : String(error) });
  }
}

const ICON_BUTTON = "size-7";

/**
 * The right side of a channel's header: its member Smiths, "+ Add smith" and
 * "⋯". `#general` has no members — every session reads it — so it shows only
 * the menu, with Pause project.
 */
export function ChannelHeaderActions({ project, channel }: { project: string; channel?: Channel }) {
  const smiths = useSmiths();
  const channels = usePeersStore((state) => state.channels);
  const paused = usePeersStore((state) => state.controls.pausedProjects.includes(project));
  const openTeam = useUi((state) => state.openTeam);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const memberIds = new Set(channel?.members.map((m) => m.smithId) ?? []);
  const addable = smiths.filter(
    (smith) => !memberIds.has(smith.id) && smith.allowedProjects.includes(project),
  );

  return (
    <div className="ml-auto flex items-center gap-1.5">
      {channel && (
        <div aria-label="Members" role="group" className="flex items-center -space-x-1.5">
          {channel.members.map((member) => (
            <DropdownMenu key={member.smithId}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={member.name}
                  className="rounded-full ring-2 ring-card focus-visible:outline-none focus-visible:ring-ring"
                >
                  <SmithAvatar smith={{ id: member.smithId, name: member.name }} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-[13px]"
                  onSelect={() => openTeam({ id: member.smithId, kind: "teammate" })}
                >
                  Open {member.name}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-[13px]"
                  onSelect={() =>
                    void apply("Could not remove the Smith", () =>
                      daemon.removeChannelMember(channel.id, member.smithId),
                    )
                  }
                >
                  Remove from #{channel.name}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ))}
        </div>
      )}
      {channel && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs">
              <Plus className="size-3.5" />
              Add smith
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {addable.length === 0 && (
              <DropdownMenuItem disabled className="text-[13px]">
                Every smith in {project} is here
              </DropdownMenuItem>
            )}
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
                <SmithAvatar smith={smith} size="size-5" />
                {smith.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Channel menu"
            className={ICON_BUTTON}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {channel ? (
            <>
              <DropdownMenuItem className="text-[13px]" onSelect={() => setRenaming(true)}>
                <Pencil className="size-3.5" />
                Rename…
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-[13px] text-destructive"
                onSelect={() => setDeleting(true)}
              >
                <Trash2 className="size-3.5" />
                Delete…
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem
              className="text-[13px]"
              title={
                paused
                  ? "Let this project's sessions message each other again"
                  : "Refuse every agent's peer messages and posts in this project"
              }
              onSelect={() =>
                void apply(paused ? "Could not resume" : "Could not pause", () =>
                  daemon.setPeerPaused(project, !paused),
                )
              }
            >
              {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {paused ? "Resume project" : "Pause project"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {channel && renaming && (
        <ChannelNameDialog
          project={project}
          current={channel.name}
          taken={Object.values(channels)
            .filter((c) => c.project === project)
            .map((c) => c.name)}
          onOpenChange={setRenaming}
          onSave={async (name) => {
            usePeersStore.getState().upsertChannel(await daemon.renameChannel(channel.id, name));
          }}
        />
      )}
      {channel && (
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
      )}
    </div>
  );
}
