# 0033 — A project is a mode of the Tasks panel, not a page

**Status:** accepted (2026-11-27) · supersedes the page shell of [0004](0004-project-page-surfaces.md) · builds on [0032](0032-permanent-rail.md)

## Context

Opening a project (tree row, rail pin, switcher) swapped the main area to a
project page: a header with name, path and ports, a `SurfaceTabs` bar
(Backlog, Pull Requests, Explorer, Runtime, Terminal, Worktrees) and the
active surface below it. The panel beside it kept listing every project's
tasks, so the screen showed one project in the middle and all of them on the
left, and the page spent two rows of chrome on navigation the panel could
carry.

## Decisions

**Project mode narrows the Tasks panel.** The UI store holds
`panelScope: { kind: "project"; name } | null`. While it is set and the rail is
on Tasks, the panel shows `ProjectPanel`: the project name with a switcher and
a back chevron, the project's sections as rows (counts for Backlog, Pull
requests and Terminal, a status light on Runtime), then a "Tasks" label with
+New task and the same virtualised `TaskTree`, filtered to the scope. With one
project in scope the tree drops that project's group row, since the header
already names it. *Rejected:* a fourth rail mode for projects — a project is
reached from inside Tasks, and a separate mode would split one tree in two.

**The section fills the main area with no tab bar.** `views/Projects.tsx`
renders only the selected section. Its title and actions (New work item on
Backlog, the project menu with Factory settings, path and port range) portal
into the window title row through `useTitleRow`'s `projectSlot`, the way a
task's side pane portals its header. When the panel is hidden the title
becomes a section picker, so sections stay reachable.

**Enter and exit rules.**
- `openProject(name)` enters the mode. If the open task belongs to that
  project it stays on screen; otherwise the project's remembered section
  (`projectSurfaceByProject`, default Backlog) shows.
- `openProject(name, section)` always shows that section.
- Opening a task of a scoped project keeps the mode; opening a task outside
  the scope (a toast, Quick Open, the inbox) leaves it.
- The back chevron (`exitPanelScope`) and the Tasks rail button
  (`selectTasksSegment`) return to every project. The view leaves `project`;
  an open task stays open.
- Removing the scoped project clears the scope.
- A pinned project is lit while its mode is active, open task included.

**The scope is generic.** `scopeProjects(scope)` turns a scope into the list
of project names the tree filters by, and `useSidebarTree` takes that list,
not a single name. Spaces ([0034](0034-spaces.md), backlog #160) add a scope
kind covering several projects and reuse the same panel and tree.

## Invariants

1. The project page has no `SurfaceTabs` and no header of its own. A new
   section is a row in `views/projects/sections.ts` plus a branch in
   `Projects.tsx`.
2. `view === "project"` only makes sense with a scope: every action that
   clears `panelScope` must also move the view off `project`, or the main area
   shows a section with no way to switch it.
3. Pass the tree's virtual range and total size into `TaskTree`, never the
   virtualizer (React Compiler caches the getters across a component
   boundary).
4. Store version 15 turns a session saved on a project into that project's
   mode.

## Consequences

- `ProjectSurfaceBar.tsx` is gone; the task workspace keeps `SurfaceTabs`.
- 0004's decisions on the backlog list, drawer, sorting and per-project
  surface memory stand. Its "surface shell" decision and invariant 6 (Radix
  tabs in surface-tab tests) no longer apply to the project page.
- The title-row project switcher moved into the panel header.
