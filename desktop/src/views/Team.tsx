import { MessagesSquare } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { Snapshot } from "@/protocol";
import { usePeersStore } from "@/store/peers";
import { useSmithsStore } from "@/store/smiths";
import { useUi } from "@/store/ui";

import type { NewTaskOptions } from "../app/dialogs";
import { labeller } from "./team/labels";
import type { TeamSelection } from "./team/selection";
import { TeammateMain } from "./team/smiths/TeammateMain";
import { TeamSidebar } from "./team/TeamSidebar";
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

/**
 * The Team screen (ADR 0026, 0027), laid out like a chat app: each project's
 * channels, the direct threads between sessions and the teammates on the
 * left; the channel's feed or the teammate's page on the right.
 */
export default function Team({ snapshot, onOpenTask, onNewTask }: Props) {
  const records = usePeersStore((state) => state.records);
  const loaded = usePeersStore((state) => state.loaded);
  const paused = usePeersStore((state) => state.controls.pausedProjects);
  const markTeamSeen = useUi((state) => state.markTeamSeen);
  const [selection, setSelection] = useState<TeamSelection | null>(null);
  /** The user's thread with a session that has none yet, once asked for. */
  const [draft, setDraft] = useState<Conversation | null>(null);

  const taskById = useMemo(
    () => new Map(snapshot.tasks.map((task) => [task.id, task])),
    [snapshot.tasks],
  );
  const smithsById = useSmithsStore((state) => state.smiths);
  const smiths = useSmiths();
  const label = useMemo(() => labeller(taskById, smithsById), [smithsById, taskById]);
  const projects = useMemo(() => snapshot.projects.map((p) => p.name), [snapshot.projects]);

  const conversations = useMemo(() => {
    const all = buildConversations(Object.values(records));
    if (draft && !all.some((c) => c.key === draft.key)) all.unshift(draft);
    return all;
  }, [draft, records]);
  const dms = useMemo(() => conversations.filter((c) => c.kind === "dm"), [conversations]);

  const firstChannel = projects[0] ? projectChannels(projects[0])[0]!.key : null;
  const current = useMemo<TeamSelection | null>(
    () => selection ?? (firstChannel ? { key: firstChannel, kind: "conversation" } : null),
    [firstChannel, selection],
  );
  const conversation = useMemo(() => {
    if (current?.kind !== "conversation") return null;
    const found = conversations.find((c) => c.key === current.key);
    if (found) return found;
    const project = projects.find((p) => projectChannels(p).some((ch) => ch.key === current.key));
    return project
      ? ({
          key: current.key,
          kind: "team",
          lastAt: 0,
          parties: null,
          project,
          records: [],
        } as Conversation)
      : null;
  }, [conversations, current, projects]);
  const candidates = useMemo(
    () => (conversation ? mentionCandidates(snapshot.tasks, conversation.project, smiths) : []),
    [conversation, smiths, snapshot.tasks],
  );

  useEffect(() => {
    markTeamSeen(Math.floor(Date.now() / 1000));
  }, [markTeamSeen, records]);

  const openUserThread = useCallback((project: string, taskId: string) => {
    const thread = userThread(project, taskId);
    setDraft(thread);
    setSelection({ key: thread.key, kind: "conversation" });
  }, []);

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
        icon={MessagesSquare}
        title="No projects yet"
        hint="Add a project to see its sessions and teammates here."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 gap-3 px-1 py-2">
      <TeamSidebar
        projects={projects}
        dms={dms}
        smiths={smiths}
        tasks={snapshot.tasks}
        pausedProjects={paused}
        selection={current}
        label={label}
        onSelect={setSelection}
      />
      {current?.kind === "teammate" || current?.kind === "newTeammate" ? (
        <TeammateMain
          selection={current}
          snapshot={snapshot}
          onSelect={setSelection}
          onOpenTask={onOpenTask}
        />
      ) : conversation && loaded ? (
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
          Loading the feed…
        </div>
      )}
    </div>
  );
}
