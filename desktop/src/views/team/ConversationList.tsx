import { Hash, PauseCircle } from "lucide-react";

import type { Conversation } from "@/lib/peerFeed";
import { cn } from "@/lib/utils";

interface Props {
  /** Threads grouped by project, projects in display order. */
  groups: { project: string; conversations: Conversation[] }[];
  selectedKey: string | null;
  pausedProjects: string[];
  label: (id: string | null | undefined) => string;
  onSelect: (key: string) => void;
}

/** The Team view's left column: each project's channel, then its direct
 *  threads grouped by pair, newest first. */
export function ConversationList({ groups, selectedKey, pausedProjects, label, onSelect }: Props) {
  return (
    <nav aria-label="Conversations" className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto">
      {groups.map(({ project, conversations }) => (
        <section key={project} aria-label={project} className="space-y-px">
          <h2 className="flex items-center gap-1.5 px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="truncate">{project}</span>
            {pausedProjects.includes(project) && (
              <PauseCircle aria-label="Paused" className="size-3 shrink-0 text-warn" />
            )}
          </h2>
          {conversations.map((conversation) => {
            const last = conversation.records[conversation.records.length - 1];
            const title =
              conversation.kind === "team"
                ? "Team channel"
                : `${label(conversation.parties?.[0])} ↔ ${label(conversation.parties?.[1])}`;
            return (
              <button
                key={conversation.key}
                type="button"
                aria-current={conversation.key === selectedKey ? "true" : undefined}
                onClick={() => onSelect(conversation.key)}
                className={cn(
                  "flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent/60",
                  conversation.key === selectedKey && "bg-accent",
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5 font-medium">
                  {conversation.kind === "team" && (
                    <Hash aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{title}</span>
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {last ? last.text : "No posts yet"}
                </span>
              </button>
            );
          })}
        </section>
      ))}
    </nav>
  );
}
