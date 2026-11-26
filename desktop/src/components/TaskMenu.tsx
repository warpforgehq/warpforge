import {
  Archive,
  MoreHorizontal,
  MoreVertical,
  Pin,
  PinOff,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useState } from "react";

import { DeleteTaskDialog } from "@/components/DeleteTaskDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { taskLabel } from "@/lib/taskLabel";
import { regenerateTaskTitle } from "@/lib/taskTitle";

import { daemon } from "../daemon";
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
            {pinned ? "Unpin from Mission Control" : "Pin to Mission Control"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void daemon.archiveTask(task.id);
              onClose();
            }}
          >
            <Archive />
            Archive task
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setConfirmingDelete(true)}
          >
            <Trash2 />
            Delete task
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeleteTaskDialog
        task={task}
        label={taskLabel(task)}
        open={confirmingDelete}
        onCancel={() => setConfirmingDelete(false)}
        onDeleted={() => {
          setConfirmingDelete(false);
          onClose();
        }}
      />
    </>
  );
}
