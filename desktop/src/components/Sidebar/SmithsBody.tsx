import { Hash, MessageSquarePlus, Plus } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { SmithAvatar } from "@/components/SmithAvatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { daemon } from "@/daemon";
import { useSmithUnread, useSmiths } from "@/hooks/useSmiths";
import { buildConversations, mentionCandidates, userThread } from "@/lib/peerFeed";
import { smithOwnNote, smithStatus } from "@/lib/smiths";
import { resolveSmithsProject } from "@/lib/smithsProject";
import { channelKey, channelUnread, projectChannels } from "@/lib/teamChannels";
import { cn } from "@/lib/utils";
import type { Smith, TaskInfo } from "@/protocol";
import { usePeersStore } from "@/store/peers";
import { useSmithsStore } from "@/store/smiths";
import { type TeamSelection, useUi } from "@/store/ui";
import { ChannelNameDialog } from "@/views/team/channels/ChannelNameDialog";
import { labeller, shortLabel } from "@/views/team/labels";

import { ProjectBadge } from "./ProjectBadge";

interface Props {
  projects: string[];
  tasks: TaskInfo[];
}

const ROW =
  "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-px">
      <div className="flex items-center justify-between px-2 pb-1">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function HeaderButton({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <Plus className="size-3.5" />
    </button>
  );
}

function Unread({ count }: { count: number }) {
  return (
    <span
      aria-label={`${count} unread`}
      className="tnum ml-auto shrink-0 rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground"
    >
      {count}
    </span>
  );
}

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
  // What it needs from you outranks what it says it is doing.
  const note =
    status.kind === "held"
      ? `held: ${status.reasons[0]}`
      : status.kind === "waiting"
        ? status.note
        : (smithOwnNote(smith, tasks) ?? (status.kind === "working" ? status.note : null));
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      className={cn(ROW, active && "bg-accent", unread > 0 && "font-semibold")}
    >
      <SmithAvatar smith={smith} status={status} />
      <span className="shrink-0">{smith.name}</span>
      {unread > 0 ? (
        <Unread count={unread} />
      ) : (
        note && (
          <span
            title={note}
            className={cn(
              "ml-auto min-w-0 truncate text-xs font-normal",
              status.kind === "waiting" ? "text-warn" : "text-muted-foreground",
            )}
          >
            {note}
          </span>
        )
      )}
    </button>
  );
}

/**
 * The sidebar body in Smiths mode, for one project at a time: its Smiths, its
 * channels and the direct threads in it.
 */
export function SmithsBody({ projects, tasks }: Props) {
  const allSmiths = useSmiths();
  const smithsById = useSmithsStore((state) => state.smiths);
  const records = usePeersStore((state) => state.records);
  const channels = usePeersStore((state) => state.channels);
  const view = useUi((state) => state.view);
  const openTaskId = useUi((state) => state.openTaskId);
  const selectedProjectId = useUi((state) => state.selectedProjectId);
  const picked = useUi((state) => state.smithsProject);
  const setSmithsProject = useUi((state) => state.setSmithsProject);
  const stored = useUi((state) => state.teamSelection);
  const openTeam = useUi((state) => state.openTeam);
  const openNewSmith = useUi((state) => state.openNewSmith);
  const channelSeenAt = useUi((state) => state.teamChannelSeenAt);
  const teamSeenAt = useUi((state) => state.teamSeenAt);
  const [creatingChannel, setCreatingChannel] = useState(false);

  const openTaskProject = tasks.find((t) => t.id === openTaskId)?.project ?? null;
  const project = resolveSmithsProject(picked, projects, selectedProjectId ?? openTaskProject);
  // Nothing is highlighted while the main area shows something else.
  const selection: TeamSelection | null = view === "team" && !openTaskId ? stored : null;
  const isConversation = (key: string) =>
    selection?.kind === "conversation" && selection.key === key;

  const smiths = allSmiths.filter((smith) => project && smith.allowedProjects.includes(project));
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const label = useMemo(() => labeller(taskById, smithsById), [smithsById, taskById]);
  const dms = useMemo(
    () =>
      buildConversations(Object.values(records), project, taskById).filter((c) => c.kind === "dm"),
    [project, records, taskById],
  );
  const dmTargets = useMemo(
    () => (project ? mentionCandidates(tasks, project, allSmiths) : []),
    [allSmiths, project, tasks],
  );

  if (!project) {
    return <p className="px-4 py-3 text-[13px] text-muted-foreground">Add a project first.</p>;
  }

  return (
    <nav aria-label="Smiths" className="flex flex-col gap-4 px-2 py-3">
      <Select value={project} onValueChange={setSmithsProject}>
        <SelectTrigger
          aria-label="Project"
          className="h-9 w-full bg-card px-2 font-medium transition-colors hover:bg-accent/60 [&>span]:line-clamp-none [&>span]:min-w-0 [&>span]:flex-1"
        >
          <SelectValue>
            <span className="flex min-w-0 items-center gap-2">
              <ProjectBadge name={project} />
              <span className="truncate">{project}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {projects.map((name) => (
            <SelectItem key={name} value={name}>
              <span className="flex min-w-0 items-center gap-2">
                <ProjectBadge name={name} />
                <span className="truncate">{name}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Section title="Smiths" action={<HeaderButton label="New smith" onClick={openNewSmith} />}>
        {smiths.length === 0 ? (
          <div className="space-y-3 px-2 py-1">
            <p className="text-[13px] text-muted-foreground">
              Smiths are your AI teammates. They remember past work, take tasks from the board and
              talk to each other.
            </p>
            <Button type="button" size="sm" onClick={openNewSmith}>
              <Plus aria-hidden className="size-3.5" />
              Create your first smith
            </Button>
          </div>
        ) : (
          smiths.map((smith) => (
            <SmithRow
              key={smith.id}
              smith={smith}
              tasks={tasks}
              active={selection?.kind === "teammate" && selection.id === smith.id}
              onSelect={() => openTeam({ id: smith.id, kind: "teammate" })}
            />
          ))
        )}
      </Section>

      <Section
        title="Channels"
        action={<HeaderButton label="New channel" onClick={() => setCreatingChannel(true)} />}
      >
        {projectChannels(project, Object.values(channels)).map((channel) => {
          const unread = isConversation(channel.key)
            ? 0
            : channelUnread(
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
                isConversation(channel.key) && "bg-accent",
                unread > 0 && "font-semibold",
              )}
            >
              <Hash aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{channel.name}</span>
              {unread > 0 && <Unread count={unread} />}
            </button>
          );
        })}
      </Section>

      <Section
        title="Direct"
        action={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="New direct message"
                title="New direct message"
                className="grid size-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Plus className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
              {dmTargets.length === 0 && (
                <DropdownMenuItem disabled className="text-[13px]">
                  No sessions in this project
                </DropdownMenuItem>
              )}
              {dmTargets.map((target) => (
                <DropdownMenuItem
                  key={target.id}
                  className="text-[13px]"
                  onSelect={() =>
                    openTeam({ key: userThread(project, target.id).key, kind: "conversation" })
                  }
                >
                  <span className="truncate">{target.label || target.id}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        {dms.length === 0 && (
          <p className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
            <MessageSquarePlus aria-hidden className="size-3.5" />
            Messages between sessions show up here.
          </p>
        )}
        {dms.map((dm) => (
          <button
            key={dm.key}
            type="button"
            aria-current={isConversation(dm.key) ? "true" : undefined}
            onClick={() => openTeam({ key: dm.key, kind: "conversation" })}
            className={cn(ROW, isConversation(dm.key) && "bg-accent")}
            title={`${label(dm.parties?.[0])} ↔ ${label(dm.parties?.[1])}`}
          >
            <span className="truncate">
              {shortLabel(label(dm.parties?.[0]))} ↔ {shortLabel(label(dm.parties?.[1]))}
            </span>
          </button>
        ))}
      </Section>

      {creatingChannel && (
        <ChannelNameDialog
          project={project}
          taken={Object.values(channels)
            .filter((c) => c.project === project)
            .map((c) => c.name)}
          onOpenChange={setCreatingChannel}
          onSave={async (name) => {
            const channel = await daemon.createChannel(project, name);
            usePeersStore.getState().upsertChannel(channel);
            openTeam({ key: channelKey(project, channel.id), kind: "conversation" });
          }}
        />
      )}
    </nav>
  );
}
