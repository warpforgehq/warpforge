import { Plus } from "lucide-react";

import type { Snapshot } from "@/protocol";
import { type TaskListView, useUi } from "@/store/ui";

import { PanelSwitcher } from "./PanelSwitcher";

const LABEL: Record<TaskListView, string> = { chats: "Chats", tasks: "Tasks" };

/**
 * The unscoped Tasks panel's title: the panel switcher on Tasks or Chats.
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

  return (
    <div
      data-tauri-drag-region="deep"
      className="flex h-10 shrink-0 items-center gap-1 pl-6 pr-3 pt-2"
    >
      <PanelSwitcher
        title={LABEL[view]}
        current={{ kind: view }}
        snapshot={snapshot}
        attention={attention}
        onOpenProject={onOpenProject}
        onAddProject={onAddProject}
      />
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
