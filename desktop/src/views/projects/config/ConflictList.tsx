import { Button } from "@/components/ui/button";
import type { ConfigConflict } from "@/lib/projectConfig/ops";
import { SettingsSection } from "@/views/settings/primitives";

const show = (value: unknown) =>
  value === undefined ? "(removed)" : typeof value === "string" ? value : JSON.stringify(value);

/**
 * Edits that collide with a change made to the file on disk, each with both values.
 * @param conflicts the colliding edits
 * @param onResolve called with the conflict and the side to keep
 */
export function ConflictList({
  conflicts,
  onResolve,
}: {
  conflicts: ConfigConflict[];
  onResolve: (conflict: ConfigConflict, keep: "mine" | "disk") => void;
}) {
  if (conflicts.length === 0) return null;
  return (
    <SettingsSection id="config-conflicts" title="Changed on disk while you were editing">
      {conflicts.map((conflict) => {
        const label = conflict.op.path.join(" › ");
        return (
          <div
            key={`${conflict.op.scope}:${label}`}
            className="flex flex-wrap items-center gap-3 px-3.5 py-2.5"
          >
            <div className="min-w-0 flex-1 text-[0.75rem]">
              <div className="font-medium text-foreground">
                {label}
                <span className="ml-1.5 font-normal text-muted-foreground">
                  {conflict.op.scope === "local" ? "Only me" : "Shared"}
                </span>
              </div>
              <div className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-2 font-mono text-muted-foreground">
                <span>On disk</span>
                <span className="truncate text-foreground">{show(conflict.disk)}</span>
                <span>Yours</span>
                <span className="truncate text-foreground">
                  {show(conflict.op.remove ? undefined : conflict.op.value)}
                </span>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onResolve(conflict, "disk")}
            >
              Use disk
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onResolve(conflict, "mine")}
            >
              Keep mine
            </Button>
          </div>
        );
      })}
    </SettingsSection>
  );
}
