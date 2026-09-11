import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ConnectionState } from "@/daemon";
import { cn } from "@/lib/utils";

/**
 * Daemon connection, reduced to the one thing that actually needs a glance:
 * is it there. The state name and any error used to sit in the topbar as
 * text ("daemon" / "connecting" / a raw error message) — permanent chrome for
 * a condition that's true almost all the time. Now it's a dot, and the detail
 * moves to a tooltip so a long error can't push or wrap the header layout.
 */
export function ConnectionDot({
  connection,
  connectionError,
}: {
  connection: ConnectionState;
  connectionError: string | null;
}) {
  const connected = connection === "connected";
  const label =
    (connected ? "Daemon connected" : connectionError) ||
    `Daemon ${connection === "connecting" ? "connecting…" : "disconnected"}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-label={label}
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            connected ? "bg-ok" : "bg-warn animate-pulse",
          )}
        />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
