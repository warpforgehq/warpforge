import { Check, ChevronDown, Loader2, type LucideIcon } from "lucide-react";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

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

export function IntentButton({
  icon: Icon,
  label,
  busy,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
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
