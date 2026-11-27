import {
  Archive,
  MoreHorizontal,
  MoreVertical,
  Pin,
  PinOff,
  Trash2,
  WandSparkles,
} from "lucide-react";

import { useTaskActions } from "@/components/TaskActionDialogs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { regenerateTaskTitle } from "@/lib/taskTitle";

import type { TaskInfo } from "../protocol";

export function TaskMenu({
  onClose,
  onTogglePin,
  pinned,
  task,
  side,
}: {
  onClose: () => void;
  onTogglePin: () => void;
  pinned: boolean;
  task: TaskInfo;
  /** Where the menu opens; below its trigger by default. */
  side?: "left" | "bottom";
}) {
  const actions = useTaskActions(task, onClose);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={
              side === "left" ? "size-7 text-muted-foreground hover:text-foreground" : "size-7"
            }
            aria-label="Task actions"
          >
            {side === "left" ? (
              <MoreVertical className="size-4" />
            ) : (
              <MoreHorizontal className="size-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side={side} align="end" className="w-48">
          <DropdownMenuItem onSelect={() => void regenerateTaskTitle(task)}>
            <WandSparkles />
            Regenerate title
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onTogglePin}>
            {pinned ? <PinOff /> : <Pin />}
            {pinned ? "Unpin from rail" : "Pin to rail"}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={actions.busy} onSelect={actions.archiveTask}>
            <Archive />
            Archive task
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={actions.busy}
            onSelect={actions.deleteTask}
          >
            <Trash2 />
            Delete task
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {actions.dialogs}
    </>
  );
}
