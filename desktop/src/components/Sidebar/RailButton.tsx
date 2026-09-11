import type { LayoutGrid } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function RailButton({
  label,
  active,
  count,
  hot,
  icon: Icon,
  onClick,
  ariaExpanded,
}: {
  label: string;
  active?: boolean;
  count?: number;
  hot?: boolean;
  icon: typeof LayoutGrid;
  onClick: () => void;
  ariaExpanded?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-expanded={ariaExpanded}
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative grid size-9 place-items-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            active
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
        >
          <Icon className={cn("size-4", active && "text-primary")} />
          {count !== undefined && count > 0 && (
            <span
              aria-hidden
              className={cn(
                "absolute right-1 top-1 size-1.5 rounded-full",
                hot ? "bg-warn" : "bg-muted-foreground/50",
              )}
            />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
        {count !== undefined && count > 0 && <span className="tnum text-warn"> {count}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
