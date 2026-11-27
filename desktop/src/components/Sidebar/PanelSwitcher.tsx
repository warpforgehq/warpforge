import { Check, ChevronDown, FolderGit2, Layers, ListTodo } from "lucide-react";
import type { MouseEvent } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Snapshot } from "@/protocol";
import { type TaskListView, useUi } from "@/store/ui";

import { ChatsBadge } from "./ProjectBadge";

/** What the Tasks panel shows: one of the two lists, or a project or space. */
export type PanelPlace = { kind: TaskListView } | { kind: "project" | "space"; id: string };

const LIST_LABEL: Record<TaskListView, string> = { chats: "Chats", tasks: "Tasks" };

function needsYouLabel(count: number): string {
  return `${count} need${count === 1 ? "s" : ""} you`;
}

function Tick({ on }: { on: boolean }) {
  return on ? <Check className="size-4 text-primary" /> : null;
}

/**
 * The Tasks panel's title as one menu over every place it can show: Tasks,
 * Chats, each space and project, then Add project. The current place is ticked.
 * @param props.title the place's name, shown as the heading
 * @param props.current the place shown
 * @param props.snapshot the daemon snapshot listing spaces and projects
 * @param props.attention how many tasks and chats need you
 * @param props.onOpenProject enters a project's mode
 * @param props.onAddProject opens Add project
 * @param props.onContextMenu right-click on the title, for pinning
 * @returns the menu trigger and its content
 */
export function PanelSwitcher({
  title,
  current,
  snapshot,
  attention,
  onOpenProject,
  onAddProject,
  onContextMenu,
}: {
  title: string;
  current: PanelPlace;
  snapshot: Snapshot;
  attention: Record<TaskListView, number>;
  onOpenProject: (name: string) => void;
  onAddProject: () => void;
  onContextMenu?: (event: MouseEvent) => void;
}) {
  const setTaskListView = useUi((s) => s.setTaskListView);
  const openSpace = useUi((s) => s.openSpace);
  const spaces = snapshot.spaces ?? [];
  // A list flags the other one; a project or space flags chats, which it never shows.
  const flagged: TaskListView =
    current.kind === "tasks" ? "chats" : current.kind === "chats" ? "tasks" : "chats";
  const hidden = attention[flagged];
  const is = (kind: PanelPlace["kind"], id?: string) =>
    current.kind === kind && (!("id" in current) || current.id === id);
  const listItem = (list: TaskListView) => (
    <DropdownMenuItem key={list} onSelect={() => setTaskListView(list)} className="gap-2">
      {list === "tasks" ? <ListTodo className="size-4 text-muted-foreground" /> : <ChatsBadge />}
      <span className="min-w-0 flex-1 truncate">{LIST_LABEL[list]}</span>
      {attention[list] > 0 && (
        <span
          title={needsYouLabel(attention[list])}
          className="font-mono text-[0.6875rem] tabular-nums text-warn"
        >
          {attention[list]}
        </span>
      )}
      <Tick on={is(list)} />
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Switch view: ${title}${hidden > 0 ? `, ${LIST_LABEL[flagged].toLowerCase()} ${needsYouLabel(hidden)}` : ""}`}
          onContextMenu={onContextMenu}
          className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <h2 className="truncate text-[1rem] font-semibold">{title}</h2>
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          {hidden > 0 && (
            <span
              data-testid="task-list-attention"
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-warn"
            />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {listItem("tasks")}
        {listItem("chats")}
        <DropdownMenuSeparator />
        {spaces.length > 0 && (
          <>
            <DropdownMenuLabel className="text-[0.75rem] font-normal text-muted-foreground">
              Spaces
            </DropdownMenuLabel>
            {spaces.map((space) => (
              <DropdownMenuItem
                key={space.id}
                onSelect={() => openSpace(space.id)}
                className="gap-2"
              >
                <Layers className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{space.name}</span>
                <Tick on={is("space", space.id)} />
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel className="text-[0.75rem] font-normal text-muted-foreground">
          Projects
        </DropdownMenuLabel>
        {snapshot.projects.map((p) => (
          <DropdownMenuItem key={p.name} onSelect={() => onOpenProject(p.name)} className="gap-2">
            <FolderGit2 className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <Tick on={is("project", p.name)} />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onAddProject} className="gap-2">
          <FolderGit2 className="size-4 text-muted-foreground" />
          Add project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
