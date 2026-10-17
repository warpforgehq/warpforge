import { Hash, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { daemon } from "@/daemon";
import { type Conversation, type MentionCandidate, userWritesIn } from "@/lib/peerFeed";
import type { PeerControls, PeerMessage } from "@/protocol";
import { usePeersStore } from "@/store/peers";

import { FeedItem } from "./FeedItem";
import { TeamComposer } from "./TeamComposer";

/** How close to the end, in pixels, still counts as reading the newest. */
const FOLLOW_SLACK = 80;

interface Props {
  conversation: Conversation;
  candidates: MentionCandidate[];
  label: (id: string | null | undefined) => string;
  onOpenTask: (id: string) => void;
  onStartSession: (project: string, text: string, sourceId: number | null) => void;
  /** Open the user's own thread with a session. */
  onMessageSession: (project: string, taskId: string) => void;
}

export async function changeControls(run: () => Promise<PeerControls>) {
  try {
    usePeersStore.getState().setControls(await run());
  } catch (error) {
    toast.error("Could not change the setting", {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

/** One thread of the Team view: its records oldest first, its controls, and
 *  the composer. */
export function Thread({
  conversation,
  candidates,
  label,
  onOpenTask,
  onStartSession,
  onMessageSession,
}: Props) {
  const controls = usePeersStore((state) => state.controls);
  const projectPaused = controls.pausedProjects.includes(conversation.project);
  const listRef = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const shownKey = useRef<string | null>(null);
  const { project, records } = conversation;
  const parties: (string | null)[] = conversation.parties ?? [];
  const sessions = parties.filter((id): id is string => !!id);

  // A new record only scrolls a reader who was already at the end; opening a
  // thread always lands there.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const opened = shownKey.current !== conversation.key;
    shownKey.current = conversation.key;
    if (opened || following.current) {
      list.scrollTop = list.scrollHeight;
      following.current = true;
    }
  }, [conversation.key, records.length]);

  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    following.current = list.scrollHeight - list.scrollTop - list.clientHeight < FOLLOW_SLACK;
  };

  const startFrom = (record: PeerMessage) => onStartSession(project, record.text, record.id);

  return (
    <section
      aria-label="Thread"
      className="flex min-h-0 min-w-0 flex-1 flex-col rounded-md border border-border p-3"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border pb-2">
        {conversation.kind === "team" ? (
          <>
            <Hash aria-hidden className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">general</h2>
            <span className="text-xs text-muted-foreground">{project}</span>
          </>
        ) : (
          <h2 className="min-w-0 truncate text-sm font-medium">
            {label(conversation.parties?.[0])} ↔ {label(conversation.parties?.[1])}
          </h2>
        )}
        <div className="ml-auto flex flex-wrap gap-1">
          {conversation.kind === "team" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              title={
                projectPaused
                  ? "Let this project's sessions message each other again"
                  : "Refuse every agent's peer messages and posts in this project"
              }
              onClick={() =>
                void changeControls(() => daemon.setPeerPaused(project, !projectPaused))
              }
            >
              {projectPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {projectPaused ? "Resume project" : "Pause project"}
            </Button>
          )}
          {sessions.map((id) => {
            const muted = controls.mutedTasks.includes(id);
            return (
              <Button
                key={id}
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                title={
                  muted
                    ? "Let this session message peers again"
                    : "Refuse this session's peer messages, posts and note"
                }
                onClick={() => void changeControls(() => daemon.setPeerMuted(id, !muted))}
              >
                {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                {muted ? "Unmute" : "Mute"} {label(id)}
              </Button>
            );
          })}
        </div>
      </header>
      <ol
        ref={listRef}
        onScroll={onScroll}
        aria-label="Messages"
        className="min-h-0 flex-1 overflow-y-auto py-2"
      >
        {records.length === 0 && (
          <li className="px-1 py-6 text-center text-[13px] text-muted-foreground">
            Nothing posted yet. Sessions read new posts with their next prompt; @mention one to hand
            it work now.
          </li>
        )}
        {records.map((record) => (
          <FeedItem
            key={record.id}
            record={record}
            label={label}
            onOpenTask={onOpenTask}
            onStartSession={startFrom}
          />
        ))}
      </ol>
      {userWritesIn(conversation) ? (
        <TeamComposer
          key={conversation.key}
          project={project}
          candidates={candidates}
          targets={
            conversation.kind === "dm"
              ? sessions.map((id) => ({ id, label: label(id) }))
              : undefined
          }
          onStartSession={(text) => onStartSession(project, text, null)}
        />
      ) : (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-3 text-[13px] text-muted-foreground">
          <span>These sessions are talking to each other.</span>
          {sessions.map((id) => (
            <Button
              key={id}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onMessageSession(project, id)}
            >
              Message {label(id)}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
