import type { TaskInfo } from "@/protocol";

import type { SidebarTaskState } from "./stateMeta";

/** Indent applied per nesting level of a subtask row, in px. On the 4px grid. */
export const SIDEBAR_INDENT_PX = 12;

/** Deeper nesting stops indenting here so the title lane keeps its minimum. */
export const SIDEBAR_MAX_INDENT_LEVELS = 5;

export const RAIL_W = 1;
export const RAIL_W_ACTIVE = 2;
export const RAIL_ELBOW_RADIUS = 4;
export const LANE_TWISTY_PX = 16;
export const LANE_GLYPH_PX = 16;
export const LANE_META_PX = 72;

export interface RailLane {
  level: number;
  /** Vertical x, centred under the chevron of the ancestor at this level so the
   *  branch reads as hanging off that arrow. */
  x: number;
  /** Horizontal run length: 0-width for a pass-through, out to the child's
   *  first glyph/text lane for a connector. */
  run: number;
  shape: "pass" | "tee" | "elbow";
  active: boolean;
}

/** Half the 16px twisty lane: centres a lane under the ancestor's chevron. */
const RAIL_LANE_OFFSET_PX = LANE_TWISTY_PX / 2;

/**
 * The tree guide for one row, as a pure function of its own rail data. No
 * measurement and no siblings, so it composes across virtualized rows: every
 * row draws its own full-height slice and adjacent slices abut at the same x.
 *
 * `depth - 1` is the connector level (elbow when the row is last, tee
 * otherwise); shallower levels pass through only when that ancestor still has
 * a following sibling. Every lane shares one grid — `level × INDENT` plus the
 * twisty half-lane — so deeper rails stay parallel and evenly spaced.
 */
export function railLanes(
  depth: number,
  ancestorLines: readonly boolean[],
  isLast: boolean,
  onActivePath: boolean,
): RailLane[] {
  if (depth <= 0) return [];
  const levels = Math.min(depth, SIDEBAR_MAX_INDENT_LEVELS);
  const lanes: RailLane[] = [];
  for (let level = 0; level < levels; level += 1) {
    const connector = level === levels - 1;
    const x = level * SIDEBAR_INDENT_PX + RAIL_LANE_OFFSET_PX;
    if (connector) {
      const childGutter = Math.min(depth, SIDEBAR_MAX_INDENT_LEVELS) * SIDEBAR_INDENT_PX;
      lanes.push({
        active: onActivePath,
        level,
        // Ends where the child's content starts: gutter + its twisty lane.
        run: childGutter + LANE_TWISTY_PX - x,
        shape: isLast ? "elbow" : "tee",
        x,
      });
    } else if (ancestorLines[level]) {
      lanes.push({ active: onActivePath, level, run: RAIL_W, shape: "pass", x });
    }
  }
  return lanes;
}

export type SidebarRow =
  | { key: string; kind: "empty"; label: string; hint: string | null }
  | {
      key: string;
      kind: "project";
      name: string;
      /** Live tasks only. The total is dominated by archive and says nothing. */
      count: number;
      attentionCount: number;
      selected: boolean;
      expanded: boolean;
      /** Diff-less finished turns in this project, for the per-project bulk
       *  settle. Empty hides the button. */
      settleIds: string[];
      /** First few settle candidates' titles, for the button's tooltip. */
      settlePreview: string[];
    }
  | {
      /** Quiet disclosure closing a project group: "12 done". */
      key: string;
      kind: "shelf";
      project: string;
      count: number;
      expanded: boolean;
      /** Every settled task in the project, safe to delete outright. Scoped
       *  to the project as a whole (not just the shelved trees above), since
       *  that is what the bulk-delete action actually removes. */
      deletableIds: string[];
      /** Settled tasks skipped because they still hold unmerged changes. */
      keptCount: number;
    }
  | {
      key: string;
      kind: "task";
      task: TaskInfo;
      depth: number;
      /** For each ancestor level 0..depth-1: does that ancestor have a
       *  following sibling, so its vertical lane must pass beside this row? */
      ancestorLines: boolean[];
      /** This row is the last of its parent's children (elbow, not tee). */
      isLast: boolean;
      /** This row is on the open task's ancestor path (root → open), inclusive. */
      onActivePath: boolean;
      childCount: number;
      expanded: boolean;
      attention: boolean;
      state: SidebarTaskState;
    };

const EMPTY_HEIGHT = 34;
const EMPTY_WITH_HINT_HEIGHT = 50;
const PROJECT_HEIGHT = 32;
const SHELF_HEIGHT = 28;
/** Equals the row button's `h-8`, so sibling rails abut with no seam (08 §D). */
const TASK_HEIGHT = 32;

/**
 * Rows are fixed-height by construction (every one truncates), so the
 * virtualizer can trust these numbers and skip DOM measurement entirely.
 */
export function rowHeight(row: SidebarRow): number {
  switch (row.kind) {
    case "empty":
      return row.hint === null ? EMPTY_HEIGHT : EMPTY_WITH_HINT_HEIGHT;
    case "project":
      return PROJECT_HEIGHT;
    case "shelf":
      return SHELF_HEIGHT;
    default:
      return TASK_HEIGHT;
  }
}
