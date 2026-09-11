import type { TaskInfo } from "@/protocol";

import type { SidebarTaskState } from "./stateMeta";

/** Indent applied per nesting level of a subtask row, in px. */
export const SIDEBAR_INDENT_PX = 14;

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
      childCount: number;
      expanded: boolean;
      attention: boolean;
      state: SidebarTaskState;
    };

const EMPTY_HEIGHT = 34;
const EMPTY_WITH_HINT_HEIGHT = 50;
const PROJECT_HEIGHT = 32;
const SHELF_HEIGHT = 28;
const TASK_HEIGHT = 34;

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
