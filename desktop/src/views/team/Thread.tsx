import { Hash, Volume2, VolumeX } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { daemon } from "@/daemon";
import { useSmiths } from "@/hooks/useSmiths";
import {
  type Conversation,
  type MentionCandidate,
  continuesGroup,
  userWritesIn,
} from "@/lib/peerFeed";
import { smithColorIndex } from "@/lib/smithColors";
import type { Channel, PeerControls, PeerMessage } from "@/protocol";
import { usePeersStore } from "@/store/peers";

import { ChannelEmpty } from "./channels/ChannelEmpty";
import { ChannelHeaderActions } from "./channels/ChannelHeaderActions";
import { FeedItem } from "./FeedItem";
import { shortLabel } from "./labels";
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

/** Who is answering in a named channel right now. */
function WorkingLine({ channel }: { channel: Channel | undefined }) {
  const names = (channel?.working ?? [])
    .map((id) => channel?.members.find((member) => member.smithId === id)?.name)
    .filter((name): name is string => !!name);
  if (names.length === 0) return null;
  const who = names.length === 1 ? `${names[0]} is` : `${names.join(", ")} are`;
  return (
    <p role="status" className="shrink-0 animate-pulse px-1 pb-1 text-xs text-muted-foreground">
      {who} replying…
    </p>
  );
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
  const [prefill, setPrefill] = useState<{ nonce: number; text: string } | null>(null);
  const smiths = useSmiths();
  const firstSmith = smiths.find((smith) => smith.allowedProjects.includes(conversation.project));
  const smithOfThread = (taskId: string | undefined) =>
    taskId ? smiths.find((smith) => smith.threadTaskId === taskId) : undefined;
  const smithColorOf = (taskId: string) => {
    const smith = smithOfThread(taskId);
    return smith ? smithColorIndex(smith) : undefined;
  };
  const channel = usePeersStore((state) =>
    conversation.channelId ? state.channels[conversation.channelId] : undefined,
  );
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
            <h2 className="text-sm font-medium">{channel?.name ?? "general"}</h2>
            <span className="text-xs text-muted-foreground">{project}</span>
          </>
        ) : (
          <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <span className="truncate" title={label(conversation.parties?.[0])}>
              {shortLabel(label(conversation.parties?.[0]))}
            </span>
            <span aria-hidden>↔</span>
            <span className="truncate" title={label(conversation.parties?.[1])}>
              {shortLabel(label(conversation.parties?.[1]))}
            </span>
          </h2>
        )}
        {conversation.kind === "team" ? (
          <ChannelHeaderActions project={project} channel={channel} />
        ) : (
          <div className="ml-auto flex flex-wrap gap-1">
            {sessions.map((id) => {
              const muted = controls.mutedTasks.includes(id);
              return (
                <Button
                  key={id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 max-w-48 px-2 text-xs"
                  aria-label={`${muted ? "Unmute" : "Mute"} ${label(id)}`}
                  title={
                    muted
                      ? `Let ${label(id)} message peers again`
                      : `Refuse ${label(id)}'s peer messages, posts and note`
                  }
                  onClick={() => void changeControls(() => daemon.setPeerMuted(id, !muted))}
                >
                  {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                  <span className="truncate">
                    {muted ? "Unmute" : "Mute"} {shortLabel(label(id))}
                  </span>
                </Button>
              );
            })}
          </div>
        )}
      </header>
      <ol
        ref={listRef}
        onScroll={onScroll}
        aria-label="Messages"
        className="min-h-0 flex-1 overflow-y-auto py-2"
      >
        {records.length === 0 &&
          (conversation.kind === "team" ? (
            <ChannelEmpty
              name={channel?.name ?? "general"}
              general={!channel}
              smithName={channel?.members[0]?.name ?? firstSmith?.name ?? null}
              onPrefill={(text) => setPrefill({ nonce: Date.now(), text })}
              onStartSession={() => onStartSession(project, "", null)}
            />
          ) : (
            <li className="px-1 py-6 text-center text-[13px] text-muted-foreground">
              Nothing said here yet.
            </li>
          ))}
        {records.map((record, index) => (
          <FeedItem
            key={record.id}
            record={record}
            label={label}
            onOpenTask={onOpenTask}
            onStartSession={startFrom}
            smith={smithOfThread(record.fromTask)}
            mentions={candidates}
            smithColorOf={smithColorOf}
            continued={continuesGroup(records[index - 1], record)}
          />
        ))}
      </ol>
      <WorkingLine channel={channel} />
      {userWritesIn(conversation) ? (
        <TeamComposer
          key={conversation.key}
          project={project}
          channel={conversation.kind === "team" ? (channel ?? null) : undefined}
          prefill={prefill}
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
