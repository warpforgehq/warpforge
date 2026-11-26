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

**Modes determine the panel.** The rail has one selection from
`railSelection(mode, settingsOpen)`. Tasks shows the project and task tree.
Inbox lists pull requests, Smiths lists teammates and channels, and Automations
lists schedules and filters. The main area can open the automations list when
the panel is hidden. Memory lives in Settings.

**Settings replace the panel and the main area.** `settingsOpen` lives in the
UI store, is never persisted, and every navigation action (`setView`,
`openTask` with an id, `openProject`, `selectTasksSegment`, `revealTask`,
`openTeam`, `openTaskWithNav`) clears it. New task clears it too. When the
panel is hidden the settings page draws its own section tabs.

## 2026-11-27 update

Mission Control and the live lane were removed. The New Task composer is the
start view when no task, project or other view is selected. Tasks restores a
remembered task or project when available. The task tree carries task
attention status and the rail supports manually pinned tasks alongside projects,
Smiths and channels.

UI storage version 13 turns the former dashboard view into the start view and
appends its saved task IDs to existing rail pins once. Pruning waits for a
complete snapshot because the daemon handshake can finish first.

## Invariants

1. Exactly one rail button carries `aria-current="page"` and the primary edge
   bar. Pins mark the open item with a ring and leave rail mode selection to the mode button.
2. No second navigation column: the settings page renders sections only when
   the panel is not showing them.
3. A new navigation action in `store/ui/nav.ts` must clear `settingsOpen`, or
   Settings will stay over the destination.
4. Colours come from theme tokens only; check all eight themes, light ones
   included, after touching the rail.
