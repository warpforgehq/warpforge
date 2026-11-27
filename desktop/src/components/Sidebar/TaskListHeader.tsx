import { Check, ChevronDown, ListTodo, Plus } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Snapshot } from "@/protocol";
import { type TaskListView, useUi } from "@/store/ui";

import { ChatsBadge } from "./ProjectBadge";
import { ScopeSwitchItems } from "./ScopeChrome";

const LABEL: Record<TaskListView, string> = { chats: "Chats", tasks: "Tasks" };

function needsYouLabel(count: number): string {
  return `${count} need${count === 1 ? "s" : ""} you`;
}

/**
 * The unscoped Tasks panel's title: a switcher between project tasks and
 * chats, then every space and project. The list not shown flags what needs you.
 * @param props.snapshot the daemon snapshot listing spaces and projects
 * @param props.attention how many tasks and chats need you
 * @param props.onOpenProject enters a project's mode
 * @param props.onAddProject opens Add project
 * @param props.onNewChat starts a chat with no project; shown in Chats
 * @returns the title row
 */
export function TaskListHeader({
  snapshot,
  attention,
  onOpenProject,
  onAddProject,
  onNewChat,
}: {
  snapshot: Snapshot;
  attention: Record<TaskListView, number>;
  onOpenProject: (name: string) => void;
  onAddProject: () => void;
  onNewChat?: () => void;
}) {
  const view = useUi((s) => s.taskListView);
  const setView = useUi((s) => s.setTaskListView);
  const other: TaskListView = view === "tasks" ? "chats" : "tasks";
  const hidden = attention[other];
  const count = (list: TaskListView) =>
    attention[list] > 0 && (
      <span
        title={needsYouLabel(attention[list])}
        className="font-mono text-[0.6875rem] tabular-nums text-warn"
      >
        {attention[list]}
      </span>
    );

  return (
    <div
      data-tauri-drag-region="deep"
      className="flex h-10 shrink-0 items-center gap-1 pl-6 pr-3 pt-2"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Switch list: ${LABEL[view]}${hidden > 0 ? `, ${LABEL[other].toLowerCase()} ${needsYouLabel(hidden)}` : ""}`}
            className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <h2 className="truncate text-[1rem] font-semibold">{LABEL[view]}</h2>
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
          <DropdownMenuItem onSelect={() => setView("tasks")} className="gap-2">
            <ListTodo className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">Tasks</span>
            {count("tasks")}
            {view === "tasks" && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setView("chats")} className="gap-2">
            <ChatsBadge />
            <span className="min-w-0 flex-1 truncate">Chats</span>
            {count("chats")}
            {view === "chats" && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <ScopeSwitchItems
            snapshot={snapshot}
            onOpenProject={onOpenProject}
            onAddProject={onAddProject}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {view === "chats" && onNewChat && (
        <button
          type="button"
          aria-label="New chat"
          title="New chat"
          onClick={onNewChat}
          className="ml-auto grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Plus aria-hidden className="size-3.5" />
        </button>
      )}
    </div>
  );
}
