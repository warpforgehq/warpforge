import { Hammer } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/ui/empty-state";
import { daemon } from "@/daemon";
import { useSmiths } from "@/hooks/useSmiths";
import {
  type Conversation,
  buildConversations,
  mentionCandidates,
  userThread,
} from "@/lib/peerFeed";
import { projectChannels } from "@/lib/teamChannels";
import type { Channel, Snapshot } from "@/protocol";
import { usePeersStore } from "@/store/peers";
import { useSmithsStore } from "@/store/smiths";
import { type TeamSelection, useUi } from "@/store/ui";

import type { NewTaskOptions } from "../app/dialogs";
import { labeller } from "./team/labels";
import { TeammateMain } from "./team/smiths/TeammateMain";
import { Thread } from "./team/Thread";

interface Props {
  snapshot: Snapshot;
  onOpenTask: (id: string) => void;
  onNewTask: (
    project?: string,
    prompt?: string,
    backlogItemId?: string,
    options?: NewTaskOptions,
  ) => void;
}

/** A user's direct thread with a session: `<project>::dm::|<task>`. */
const USER_THREAD = /^(.*)::dm::\|(.+)$/;

/**
 * @param key a conversation key the sidebar picked
 * @param projects the registered projects
 * @param channels the named channels
 * @returns the empty thread it names, before anything was said in it
 */
function emptyConversation(
  key: string,
  projects: string[],
  channels: Channel[],
): Conversation | null {
  const user = USER_THREAD.exec(key);
  if (user) return userThread(user[1]!, user[2]!);
  for (const project of projects) {
    const found = projectChannels(project, channels).find((ch) => ch.key === key);
    if (!found) continue;
    return {
      key,
      kind: "team",
      lastAt: 0,
      parties: null,
      project,
      records: [],
      ...(found.channel ? { channelId: found.channel.id } : {}),
    };
  }
  return null;
}

/**
 * The Smiths main area (ADR 0026, 0027): the channel, direct thread or Smith
 * picked in the sidebar's Smiths mode.
 */
export default function Team({ snapshot, onOpenTask, onNewTask }: Props) {
  const records = usePeersStore((state) => state.records);
  const loaded = usePeersStore((state) => state.loaded);
  const markTeamSeen = useUi((state) => state.markTeamSeen);
  const markChannelSeen = useUi((state) => state.markChannelSeen);
  const channels = usePeersStore((state) => state.channels);
  const stored = useUi((state) => state.teamSelection);
  const openTeam = useUi((state) => state.openTeam);

  const taskById = useMemo(
    () => new Map(snapshot.tasks.map((task) => [task.id, task])),
    [snapshot.tasks],
  );
  const smithsById = useSmithsStore((state) => state.smiths);
  const smiths = useSmiths();
  const label = useMemo(() => labeller(taskById, smithsById), [smithsById, taskById]);
  const projects = useMemo(() => snapshot.projects.map((p) => p.name), [snapshot.projects]);

  const firstChannel = projects[0] ? projectChannels(projects[0])[0]!.key : null;
  const selection = useMemo<TeamSelection | null>(
    () => stored ?? (firstChannel ? { key: firstChannel, kind: "conversation" } : null),
    [firstChannel, stored],
  );
  const conversation = useMemo(() => {
    if (selection?.kind !== "conversation") return null;
    return (
      buildConversations(Object.values(records)).find((c) => c.key === selection.key) ??
      emptyConversation(selection.key, projects, Object.values(channels))
    );
  }, [channels, projects, records, selection]);
  const candidates = useMemo(
    () => (conversation ? mentionCandidates(snapshot.tasks, conversation.project, smiths) : []),
    [conversation, smiths, snapshot.tasks],
  );

  useEffect(() => {
    const now = Math.floor(Date.now() / 1000);
    markTeamSeen(now);
    if (conversation?.kind === "team") markChannelSeen(conversation.key, now);
  }, [conversation?.key, conversation?.kind, markChannelSeen, markTeamSeen, records]);

  const openUserThread = useCallback(
    (project: string, taskId: string) =>
      openTeam({ key: userThread(project, taskId).key, kind: "conversation" }),
    [openTeam],
  );

  const startSession = useCallback(
    (project: string, text: string, sourceId: number | null) => {
      onNewTask(project, text, undefined, {
        onCreated: (taskId) => {
          daemon.recordStartedFromPost(taskId, sourceId).catch((error: unknown) => {
            toast.error("Session started, but the channel line was not recorded", {
              description: error instanceof Error ? error.message : String(error),
            });
          });
        },
      });
    },
    [onNewTask],
  );

  if (projects.length === 0) {
    return (
      <EmptyState
        icon={Hammer}
        title="No projects yet"
        hint="Add a project to see its sessions and Smiths here."
      />
    );
  }
  if (selection?.kind === "teammate" || selection?.kind === "newTeammate") {
    return (
      <div className="flex h-full min-h-0 min-w-0 px-1 py-2">
        <TeammateMain
          selection={selection}
          snapshot={snapshot}
          onSelect={openTeam}
          onOpenTask={onOpenTask}
        />
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 min-w-0 px-1 py-2">
      {conversation && loaded ? (
        <Thread
          conversation={conversation}
          candidates={candidates}
          label={label}
          onOpenTask={onOpenTask}
          onStartSession={startSession}
          onMessageSession={openUserThread}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
          {loaded ? "Pick a channel or a Smith in the sidebar." : "Loading the feed…"}
        </div>
      )}
    </div>
  );
}
