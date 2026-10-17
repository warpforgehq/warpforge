import { Hash, PauseCircle, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { useSmithUnread } from "@/hooks/useSmiths";
import type { Conversation } from "@/lib/peerFeed";
import { smithStatus } from "@/lib/smiths";
import { NAMED_CHANNELS, projectChannels } from "@/lib/teamChannels";
import { cn } from "@/lib/utils";
import type { Smith, TaskInfo } from "@/protocol";

import type { TeamSelection } from "./selection";

interface Props {
  projects: string[];
  /** Direct threads, newest first. */
  dms: Conversation[];
  smiths: Smith[];
  tasks: TaskInfo[];
  pausedProjects: string[];
  selection: TeamSelection | null;
  label: (id: string | null | undefined) => string;
  onSelect: (selection: TeamSelection) => void;
}

const ROW =
  "flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] transition-colors hover:bg-accent/60";

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

function Unread({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} unread`}
      className="tnum ml-auto shrink-0 rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground"
    >
      {count}
    </span>
  );
}

const DOT: Record<ReturnType<typeof smithStatus>["kind"], string> = {
  held: "bg-warn",
  idle: "bg-muted-foreground/40",
  working: "bg-ok",
};

function TeammateRow({
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
      <Unread count={unread} />
    </button>
  );
}

/**
 * The Team view's left column: each project's channels, the direct threads,
 * and the teammates. Named channels slot in under their project once the
 * daemon serves them.
 */
export function TeamSidebar({
  projects,
  dms,
  smiths,
  tasks,
  pausedProjects,
  selection,
  label,
  onSelect,
}: Props) {
  const isConversation = (key: string) =>
    selection?.kind === "conversation" && selection.key === key;
  return (
    <nav aria-label="Team" className="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto pr-1">
      <Section title="Channels">
        {projects.map((project) => (
          <div key={project} className="space-y-px">
            <div className="flex items-center gap-1.5 px-2 pt-1 text-xs text-muted-foreground">
              <span className="truncate">{project}</span>
              {pausedProjects.includes(project) && (
                <PauseCircle aria-label="Paused" className="size-3 shrink-0 text-warn" />
              )}
            </div>
            {projectChannels(project).map((channel) => (
              <button
                key={channel.key}
                type="button"
                aria-current={isConversation(channel.key) ? "true" : undefined}
                onClick={() => onSelect({ key: channel.key, kind: "conversation" })}
                className={cn(ROW, "pl-4", isConversation(channel.key) && "bg-accent")}
              >
                <Hash aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{channel.name}</span>
              </button>
            ))}
            {NAMED_CHANNELS && (
              <button type="button" className={cn(ROW, "pl-4 text-muted-foreground")}>
                <Plus aria-hidden className="size-3.5 shrink-0" />
                New channel
              </button>
            )}
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
              onClick={() => onSelect({ key: dm.key, kind: "conversation" })}
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

      <Section title="Teammates">
        {smiths.map((smith) => (
          <TeammateRow
            key={smith.id}
            smith={smith}
            tasks={tasks}
            active={selection?.kind === "teammate" && selection.id === smith.id}
            onSelect={() => onSelect({ id: smith.id, kind: "teammate" })}
          />
        ))}
        <button
          type="button"
          onClick={() => onSelect({ kind: "newTeammate" })}
          className={cn(
            ROW,
            "text-muted-foreground",
            selection?.kind === "newTeammate" && "bg-accent",
          )}
        >
          <Plus aria-hidden className="size-3.5 shrink-0" />
          New teammate
        </button>
      </Section>
    </nav>
  );
}
