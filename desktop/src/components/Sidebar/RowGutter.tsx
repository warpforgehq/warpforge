import { cn } from "@/lib/utils";

import { RAIL_ELBOW_RADIUS, RAIL_W_ACTIVE, type RailLane, railLanes } from "./logic";

/**
 * The tree guide for one task row, drawn per row so it survives virtualization:
 * every lane is a full-slot-height slice computed from the row's own
 * `(depth, ancestorLines, isLast, onActivePath)`. Two rows that should abut
 * draw their verticals at the same x and to the same height, so the line is
 * continuous whichever rows the virtualizer has mounted (spec 08 §D).
 *
 * Each lane's vertical is centred under the chevron of the ancestor at that
 * level, so the branch reads as hanging off the arrow that expands the group;
 * the connector's horizontal ends at the row's first glyph lane. Base lanes are
 * the neutral `rule`; on the open task's path only the *vertical* is overlaid
 * at `RAIL_W_ACTIVE` `primary`, tracing the branch without painting across the
 * row.
 */
export function RowGutter({
  depth,
  ancestorLines,
  isLast,
  onActivePath,
}: {
  depth: number;
  ancestorLines: readonly boolean[];
  isLast: boolean;
  onActivePath: boolean;
}) {
  const lanes = railLanes(depth, ancestorLines, isLast, onActivePath);
  if (lanes.length === 0) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0">
      {lanes.map((lane) => (
        <Lane key={lane.level} lane={lane} />
      ))}
    </div>
  );
}

/** The bright chain the open task sits on: a 2px vertical, never a row bar. */
function ActiveVertical({ className }: { className?: string }) {
  return (
    <span
      className={cn("absolute left-0 top-0 bg-primary", className)}
      style={{ width: RAIL_W_ACTIVE }}
    />
  );
}

function Lane({ lane }: { lane: RailLane }) {
  return (
    <span
      data-rail-level={lane.level}
      data-rail-shape={lane.shape}
      data-rail-active={lane.active || undefined}
      className="absolute inset-y-0"
      style={{ left: lane.x, width: lane.run }}
    >
      {lane.shape === "elbow" ? (
        <>
          <span
            className="absolute left-0 top-0 h-1/2 w-full border-b border-l border-rule"
            style={{ borderBottomLeftRadius: RAIL_ELBOW_RADIUS }}
          />
          {lane.active && <ActiveVertical className="h-1/2" />}
        </>
      ) : (
        <>
          <span className="absolute inset-y-0 left-0 w-px bg-rule" />
          {lane.active && <ActiveVertical className="inset-y-0" />}
          {lane.shape === "tee" && (
            <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-rule" />
          )}
        </>
      )}
    </span>
  );
}
