import { defaultSmithColor, smithColor } from "@/lib/smithColors";
import { cn } from "@/lib/utils";

import { LANE_GLYPH_PX } from "./logic";

/** A project's letter tile, as the Tasks tree shows it, tinted by its name. */
export function ProjectBadge({ name, className }: { name: string; className?: string }) {
  const index = defaultSmithColor(name);
  return (
    <span
      aria-hidden
      style={{
        height: LANE_GLYPH_PX,
        width: LANE_GLYPH_PX,
        backgroundColor: smithColor(index, 0.18),
        color: smithColor(index),
      }}
      className={cn(
        "grid shrink-0 place-items-center rounded-[5px] text-[11px] font-bold uppercase leading-none",
        className,
      )}
    >
      {name.slice(0, 1)}
    </span>
  );
}
