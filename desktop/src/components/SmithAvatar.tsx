import { smithColor, smithColorIndex } from "@/lib/smithColors";
import type { SmithStatus } from "@/lib/smiths";
import { cn } from "@/lib/utils";
import { useUi } from "@/store/ui";

const STATUS_DOT: Record<SmithStatus["kind"], string> = {
  held: "bg-warn",
  idle: "bg-muted-foreground/50",
  waiting: "bg-warn",
  working: "bg-ok",
};

const STATUS_TEXT: Record<SmithStatus["kind"], string> = {
  held: "held",
  idle: "idle",
  waiting: "waiting on you",
  working: "working",
};

/**
 * A Smith's initial in its colour (a theme palette token), with an optional
 * status dot.
 * @param props.smith the Smith's id and name
 * @param props.status its status, for the dot
 * @param props.size the circle's size class
 * @returns the avatar
 */
export function SmithAvatar({
  smith,
  status,
  size = "size-6",
  className,
}: {
  smith: { id: string; name: string };
  status?: SmithStatus;
  size?: string;
  className?: string;
}) {
  const index = useUi((state) => smithColorIndex(smith.id, state.smithColors));
  const label = status ? `${smith.name}, ${STATUS_TEXT[status.kind]}` : smith.name;
  return (
    <span role="img" aria-label={label} className={cn("relative inline-flex shrink-0", className)}>
      <span
        aria-hidden
        className={cn(
          "grid place-items-center rounded-full text-[11px] font-semibold uppercase",
          size,
        )}
        style={{ backgroundColor: smithColor(index, 0.18), color: smithColor(index) }}
      >
        {Array.from(smith.name)[0] ?? "?"}
      </span>
      {status && (
        <span
          aria-hidden
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card",
            STATUS_DOT[status.kind],
          )}
        />
      )}
    </span>
  );
}
