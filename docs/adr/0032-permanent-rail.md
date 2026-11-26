# 0032 — A permanent rail picks, the panel beside it shows

**Status:** accepted (2026-11-26) · backlog #158

## Context

The desktop sidebar had two shapes: an expanded column with its own brand row,
modes and views, and a separate icon rail drawn only while the sidebar was
collapsed. Settings opened as a full-screen overlay with a navigation column
of its own, so the app could show two side-by-side navigations. The collapsed
rail lit its active bar on more than one item at once, and Mission Control was
a "view" that could be marked beside a "mode".

## Decisions

**The rail is always mounted.** `Sidebar` renders `Rail` plus, unless
collapsed, a panel. Collapsing (⌘\) removes only the panel. The persisted
`sidebarWidth` is the panel's width, so widths stored before the rail existed
keep the same room for the tree; the split adds `RAIL_WIDTH` on top. Narrow windows render the rail alone, outside the panel group.

**Mission Control is a mode.** `SidebarMode` gained `"control"`, so the rail's
selection is one value: `railSelection(mode, settingsOpen)`. Its panel is the
task tree. Opening a task from the tree while in Mission Control moves the
mode to Tasks. Automations and Memory stay main-area views in the panel footer; while the
panel is hidden (collapsed or narrow) the rail shows them instead, unselected.

**Settings replace the panel and the main area.** `settingsOpen` lives in the
UI store, is never persisted, and every navigation action (`setView`,
`openTask` with an id, `openProject`, `selectTasksSegment`, `revealTask`,
`openTeam`, `openTaskWithNav`) clears it. New task clears it too. When the
panel is hidden the settings page draws its own section tabs.

## Invariants

1. Exactly one rail button carries `aria-current="page"` and the primary edge
   bar. Live-task chips mark the open task with a border, not a selection.
2. No second navigation column: the settings page renders sections only when
   the panel is not showing them.
3. A new navigation action in `store/ui/nav.ts` must clear `settingsOpen`, or
   Settings will stay over the destination.
4. Colours come from theme tokens only; check all eight themes, light ones
   included, after touching the rail.
