import { Hash, PauseCircle, Plus } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { daemon } from "@/daemon";
import { useSmithUnread, useSmiths } from "@/hooks/useSmiths";
import { buildConversations } from "@/lib/peerFeed";
import { smithStatus } from "@/lib/smiths";
import { channelKey, channelUnread, projectChannels } from "@/lib/teamChannels";
import { cn } from "@/lib/utils";
import type { Smith, TaskInfo } from "@/protocol";
import { usePeersStore } from "@/store/peers";
import { useSmithsStore } from "@/store/smiths";
import { type TeamSelection, useUi } from "@/store/ui";
import { ChannelNameDialog } from "@/views/team/channels/ChannelNameDialog";
import { labeller } from "@/views/team/labels";

interface Props {
  projects: string[];
  tasks: TaskInfo[];
}

const ROW =
  "flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-px">
      <h2 className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

const DOT: Record<ReturnType<typeof smithStatus>["kind"], string> = {
  held: "bg-warn",
  idle: "bg-muted-foreground/40",
  working: "bg-ok",
};

function SmithRow({
  smith,
  tasks,
  active,
  onSelect,
}: {
  smith: Smith;
  tasks: TaskInfo[];
  active: boolean;
  onSelect: () => void;
}) {
  const status = smithStatus(smith, tasks);
  const unread = useSmithUnread(smith, tasks);
  const statusText = status.kind === "held" ? `held: ${status.reasons.join("; ")}` : status.kind;
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      className={cn(ROW, active && "bg-accent", unread > 0 && "font-semibold")}
    >
      <span
        role="img"
        aria-label={statusText}
        title={statusText}
        className={cn("size-2 shrink-0 rounded-full", DOT[status.kind])}
      />
      <span className="truncate">{smith.name}</span>
      {unread > 0 && (
        <span
          aria-label={`${unread} unread`}
          className="tnum ml-auto shrink-0 rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground"
        >
          {unread}
        </span>
      )}
    </button>
  );
}

/**
 * The sidebar body in Smiths mode: the Smiths, each project's channels, and
 * the direct threads. Named channels slot in under their project once the
 * daemon serves them (backlog #126).
 */
export function SmithsBody({ projects, tasks }: Props) {
  const smiths = useSmiths();
  const smithsById = useSmithsStore((state) => state.smiths);
  const records = usePeersStore((state) => state.records);
  const paused = usePeersStore((state) => state.controls.pausedProjects);
  const view = useUi((state) => state.view);
  const openTaskId = useUi((state) => state.openTaskId);
  const stored = useUi((state) => state.teamSelection);
  const openTeam = useUi((state) => state.openTeam);
  // Nothing is highlighted while the main area shows something else.
  const selection: TeamSelection | null = view === "team" && !openTaskId ? stored : null;

  const label = useMemo(
    () => labeller(new Map(tasks.map((task) => [task.id, task])), smithsById),
    [smithsById, tasks],
  );
  const dms = useMemo(
    () => buildConversations(Object.values(records)).filter((c) => c.kind === "dm"),
    [records],
  );
  const channels = usePeersStore((state) => state.channels);
  const channelSeenAt = useUi((state) => state.teamChannelSeenAt);
  const teamSeenAt = useUi((state) => state.teamSeenAt);
  const [creating, setCreating] = useState<string | null>(null);
  const isConversation = (key: string) =>
    selection?.kind === "conversation" && selection.key === key;

  return (
    <nav aria-label="Smiths" className="flex flex-col gap-4 px-2 py-3">
      {smiths.length === 0 ? (
        <div className="space-y-3 px-2 py-1">
          <p className="text-[13px] text-muted-foreground">
            Smiths are your AI teammates. They remember past work, take tasks from the board and
            talk to each other.
          </p>
          <Button type="button" size="sm" onClick={() => openTeam({ kind: "newTeammate" })}>
            <Plus aria-hidden className="size-3.5" />
            Create your first smith
          </Button>
        </div>
      ) : (
        <div className="space-y-px">
          {smiths.map((smith) => (
            <SmithRow
              key={smith.id}
              smith={smith}
              tasks={tasks}
              active={selection?.kind === "teammate" && selection.id === smith.id}
              onSelect={() => openTeam({ id: smith.id, kind: "teammate" })}
            />
          ))}
          <button
            type="button"
            onClick={() => openTeam({ kind: "newTeammate" })}
            className={cn(
              ROW,
              "text-muted-foreground",
              selection?.kind === "newTeammate" && "bg-accent",
            )}
          >
            <Plus aria-hidden className="size-3.5 shrink-0" />
            New smith
          </button>
        </div>
      )}

      <Section title="Channels">
        {projects.map((project) => (
          <div key={project} className="space-y-px">
            <div className="flex items-center gap-1.5 px-2 pt-1 text-xs text-muted-foreground">
              <span className="truncate">{project}</span>
              {paused.includes(project) && (
                <PauseCircle aria-label="Paused" className="size-3 shrink-0 text-warn" />
              )}
            </div>
            {projectChannels(project, Object.values(channels)).map((channel) => {
              const unread = channelUnread(
                Object.values(records),
                channel.key,
                channelSeenAt[channel.key] ?? teamSeenAt,
              );
              return (
                <button
                  key={channel.key}
                  type="button"
                  aria-current={isConversation(channel.key) ? "true" : undefined}
                  onClick={() => openTeam({ key: channel.key, kind: "conversation" })}
                  className={cn(
                    ROW,
                    "pl-4",
                    isConversation(channel.key) && "bg-accent",
                    unread > 0 && "font-semibold",
                  )}
                >
                  <Hash aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{channel.name}</span>
                  {unread > 0 && !isConversation(channel.key) && (
                    <span
                      aria-label={`${unread} unread`}
                      className="tnum ml-auto shrink-0 text-[11px] text-muted-foreground"
                    >
                      {unread}
                    </span>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setCreating(project)}
              className={cn(ROW, "pl-4 text-muted-foreground")}
            >
              <Plus aria-hidden className="size-3.5 shrink-0" />
              New channel
            </button>
          </div>
        ))}
      </Section>

      {dms.length > 0 && (
        <Section title="Direct messages">
          {dms.map((dm) => (
            <button
              key={dm.key}
              type="button"
              aria-current={isConversation(dm.key) ? "true" : undefined}
              onClick={() => openTeam({ key: dm.key, kind: "conversation" })}
              className={cn(ROW, isConversation(dm.key) && "bg-accent")}
            >
              <span className="truncate">
                {label(dm.parties?.[0])} ↔ {label(dm.parties?.[1])}
              </span>
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                {dm.project}
              </span>
            </button>
          ))}
        </Section>
      )}
      {creating && (
        <ChannelNameDialog
          project={creating}
          taken={Object.values(channels)
            .filter((c) => c.project === creating)
            .map((c) => c.name)}
          onOpenChange={(open) => !open && setCreating(null)}
          onSave={async (name) => {
            const channel = await daemon.createChannel(creating, name);
            usePeersStore.getState().upsertChannel(channel);
            openTeam({ key: channelKey(creating, channel.id), kind: "conversation" });
          }}
        />
      )}
    </nav>
  );
}
