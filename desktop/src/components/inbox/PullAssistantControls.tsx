import { Check, ChevronDown, Loader2, type LucideIcon } from "lucide-react";
import type * as React from "react";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { daemon } from "@/daemon";
import { findPrAssistantTask } from "@/lib/taskOrigin";
import { cn } from "@/lib/utils";
import type { PullRequestSummary } from "@/protocol";
import { useUi } from "@/store/ui";

export function PickerMenu({
  label,
  title,
  icon,
  items,
  disabled,
}: {
  label: string;
  title: string;
  icon?: React.ReactNode;
  items: { label: string; icon?: React.ReactNode; selected: boolean; onSelect: () => void }[];
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={title}
        className="flex h-6 min-w-0 items-center gap-1.5 rounded px-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        {icon}
        <span className="max-w-40 truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {items.map((item) => (
            <DropdownMenuItem
              key={item.label}
              onSelect={item.onSelect}
              className={cn("gap-2", item.selected && "text-foreground")}
            >
              {item.icon}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.selected && <Check className="size-3 shrink-0 text-primary" aria-hidden />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}

/**
 * The Assistant's thread, offered where the other "this becomes a task"
 * choices are. It reads the task list itself so opening the menu is what costs
 * a daemon subscription, not rendering the pull request.
 */
export function AssistantThreadItem({ pr }: { pr: PullRequestSummary }) {
  const state = useSyncExternalStore(daemon.subscribe, daemon.getState);
  const task = findPrAssistantTask(state.snapshot.tasks, pr);
  const openTask = useUi((s) => s.openTask);
  return (
    <DropdownMenuItem
      className="flex-col items-start gap-0.5 px-2 py-1.5"
      disabled={!task}
      onSelect={() => task && openTask(task.id)}
    >
      <span className="text-sm">Continue in a task</span>
      <span className="text-[11px] text-muted-foreground">
        {task
          ? "Moves the Assistant's conversation into its own task, away from this pull request"
          : "Ask the Assistant something first"}
      </span>
    </DropdownMenuItem>
  );
}

export function IntentButton({
  icon: Icon,
  label,
  title,
  busy,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  title?: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      title={title}
      className="h-6 shrink-0 gap-1.5 px-2 text-xs"
      disabled={disabled}
      onClick={onClick}
    >
      {busy ? (
        <Loader2 className="size-3 animate-spin" aria-hidden />
      ) : (
        <Icon className="size-3" aria-hidden />
      )}
      {label}
    </Button>
  );
}
