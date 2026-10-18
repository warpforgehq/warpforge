import { cn } from "@/lib/utils";

import { LANE_GLYPH_PX } from "./logic";

/** A project's letter tile, as the Tasks tree shows it. */
export function ProjectBadge({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ height: LANE_GLYPH_PX, width: LANE_GLYPH_PX }}
      className={cn(
        "grid shrink-0 place-items-center rounded-[5px] bg-secondary text-[11px] font-bold uppercase leading-none text-muted-foreground",
        className,
      )}
    >
      {name.slice(0, 1)}
    </span>
  );
}
