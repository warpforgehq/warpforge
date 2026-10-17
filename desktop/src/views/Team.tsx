import { MessagesSquare, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { daemon } from "@/daemon";
import {
  type Conversation,
  buildConversations,
  mentionCandidates,
  userThread,
} from "@/lib/peerFeed";
import type { Snapshot } from "@/protocol";
import { usePeersStore } from "@/store/peers";
import { useUi } from "@/store/ui";

import type { NewTaskOptions } from "../app/dialogs";
import { ConversationList } from "./team/ConversationList";
import { labeller } from "./team/labels";
import { Thread, changeControls } from "./team/Thread";

const ALL = "__all__";

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
 * The Team screen (ADR 0026): every project's channel and the direct messages
 * between its sessions, where the user watches them talk, posts, hands work
 * out by @mention, and mutes or pauses them.
 */
export default function Team({ snapshot, onOpenTask, onNewTask }: Props) {
  const records = usePeersStore((state) => state.records);
  const loaded = usePeersStore((state) => state.loaded);
  const paused = usePeersStore((state) => state.controls.pausedProjects);
  const markTeamSeen = useUi((state) => state.markTeamSeen);
  const [filter, setFilter] = useState<string>(ALL);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** The user's thread with a session that has none yet, once asked for. */
  const [draft, setDraft] = useState<Conversation | null>(null);

  const taskById = useMemo(
    () => new Map(snapshot.tasks.map((task) => [task.id, task])),
    [snapshot.tasks],
  );
  const label = useMemo(() => labeller(taskById), [taskById]);
  const projects = useMemo(() => snapshot.projects.map((p) => p.name), [snapshot.projects]);
  const shown = useMemo(
    () => (filter === ALL ? projects : projects.filter((p) => p === filter)),
    [filter, projects],
  );

  const groups = useMemo(() => {
    const conversations = buildConversations(
      Object.values(records),
      filter === ALL ? null : filter,
    );
    return shown.map((project) => {
      const own = conversations.filter((c) => c.project === project);
      const channel: Conversation = own.find((c) => c.kind === "team") ?? {
        key: `${project}::team`,
        kind: "team",
        lastAt: 0,
        parties: null,
        project,
        records: [],
      };
      const dms = own.filter((c) => c.kind === "dm");
      if (draft?.project === project && !dms.some((c) => c.key === draft.key)) dms.unshift(draft);
      return { conversations: [channel, ...dms], project };
    });
  }, [draft, filter, records, shown]);

  const all = groups.flatMap((group) => group.conversations);
  const selected = all.find((c) => c.key === selectedKey) ?? all[0] ?? null;
  const candidates = useMemo(
    () => (selected ? mentionCandidates(snapshot.tasks, selected.project) : []),
    [selected, snapshot.tasks],
  );

  useEffect(() => {
    markTeamSeen(Math.floor(Date.now() / 1000));
  }, [markTeamSeen, records]);

  const openUserThread = useCallback((project: string, taskId: string) => {
    const thread = userThread(project, taskId);
    setDraft(thread);
    setSelectedKey(thread.key);
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

  const pausedHere = filter !== ALL && paused.includes(filter);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-x-4 gap-y-2 px-1 pb-3 pt-2">
        <div className="min-w-0 space-y-1.5">
          <h1 className="truncate text-xl font-semibold leading-none tracking-tight">Team</h1>
          <p className="truncate text-[13px] text-muted-foreground">
            What your sessions tell each other, and where you hand out work.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {filter !== ALL && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              title={
                pausedHere
                  ? "Let this project's sessions message each other again"
                  : "Refuse every agent's peer messages and posts in this project"
              }
              onClick={() => void changeControls(() => daemon.setPeerPaused(filter, !pausedHere))}
            >
              {pausedHere ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {pausedHere ? "Resume project" : "Pause project"}
            </Button>
          )}
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger aria-label="Project" className="h-8 w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All projects</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project} value={project}>
                  {project}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      {projects.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="No projects yet"
          hint="Add a project to see its sessions talk to each other here."
        />
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 px-1 pb-2">
          <ConversationList
            groups={groups}
            selectedKey={selected?.key ?? null}
            pausedProjects={paused}
            label={label}
            onSelect={setSelectedKey}
          />
          {selected && loaded ? (
            <Thread
              conversation={selected}
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
      )}
    </div>
  );
}
