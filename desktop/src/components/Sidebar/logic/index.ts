/**
 * Presentation model for the sidebar. Everything here is pure so the row
 * anatomy, the state encoding and the flattening of the workspace tree can be
 * asserted without rendering: the component is left with layout only.
 *
 * The governing rule is *silence by default*. `waiting` is the resting state of
 * every task an agent has finished, so decorating it — and `queued` — made
 * "this row wants something" mean nothing: the tree became a wall of warn
 * glyphs and the "Needs you" section a settling tank. A glyph now has to earn
 * its place, so a row only carries one when it genuinely deviates from "nothing
 * is happening and nothing is needed from you".
 */

export { buildSidebarRows, type SidebarRowsInput } from "./buildRows";
export { projectActivityAt, projectNames, sortProjectsByActivity } from "./projects";
export { rowHeight, SIDEBAR_INDENT_PX, type SidebarRow } from "./row";
export { isSnoozed, snoozeWakeLabel } from "./snooze";
export {
  SIDEBAR_STATE_META,
  type SidebarStateIcon,
  type SidebarStateMeta,
  type SidebarTaskState,
} from "./stateMeta";
export { needsHuman, resolveTaskState } from "./taskState";
export { ancestorIds, isSettledTask, isSettledTree } from "./tree";
