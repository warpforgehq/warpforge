import { MessagesSquare } from "lucide-react";

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

/** The Chats group's tile: a project tile in a neutral tint, with a glyph for the letter. */
export function ChatsBadge() {
  return (
    <span
      aria-hidden
      style={{ height: LANE_GLYPH_PX, width: LANE_GLYPH_PX }}
      className="grid shrink-0 place-items-center rounded-[5px] bg-muted-foreground/15 text-muted-foreground"
    >
      <MessagesSquare className="size-[11px]" strokeWidth={2.5} />
    </span>
  );
}
