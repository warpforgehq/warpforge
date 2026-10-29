import { Archive, MoreHorizontal, Pin, PinOff, Trash2 } from "lucide-react";
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

import { daemon } from "../daemon";
import type { TaskInfo } from "../protocol";

export function TaskMenu({
  onClose,
  onTogglePin,
  pinned,
  task,
}: {
  onClose: () => void;
  onTogglePin: () => void;
  pinned: boolean;
  task: TaskInfo;
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
            className="size-7"
            aria-label="Task actions"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
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
