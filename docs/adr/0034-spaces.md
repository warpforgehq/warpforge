# 0034 — A space groups projects, and a task sees its siblings as extra folders

**Status:** accepted (2026-11-28) · backlog #160 · builds on 0033 (project mode)

## Context

One product often lives in several repositories: a monorepo, two infra repos
and a repo of Kubernetes schemas, for example. Warpforge registers each as its
own project, so an agent started in one of them sees only that checkout. The
owner's work setup restricts Claude to the repository it was launched in,
which makes cross-repo changes (an API change plus its Helm values) a manual
relay between sessions.

A known shape for the agent half: a project has a home folder plus tracked
folders, the home folder is the agent's cwd, and the others are passed to the
agent as extra roots and listed in its instructions.

Two facts make the agent half cheap here:

- Every agent runs through ACP. `session/new` and `session/load`
  (`acp/session/init.rs`) send only `{cwd, mcpServers}` today.
- The installed adapters already accept extra folders: claude-agent-acp 0.112
  advertises `sessionCapabilities.additionalDirectories` and maps it to the
  SDK's `additionalDirectories`; codex-acp 2.12.1 maps the same field into
  `sandbox_workspace_write.writable_roots`. No CLI `--add-dir` is involved.

## Decisions

**A space is a named group of registered projects, plus optional loose
folders.** It is not a new kind of project: each member keeps its own
services, ports, backlog, worktrees and pull requests. A loose folder is a
path that is not worth registering (a schemas checkout with no services); it
can be promoted to a project later. *Rejected:* a project with tracked folders
(the home-plus-tracked-folders shape) as the only model — the owner already has the member repos
registered as projects with their own services, and folding them into one
project would throw that away.

**A project belongs to at most one space.** A task's context is "its project's
space". If a project could sit in two, every task would need a choice of
which siblings to see, and the choice would have to survive a resume.

**Membership comes from two sources, merged.**
- Local: `~/.warpforge/spaces.json`, edited from the desktop. Paths differ
  per machine, so this is the source of truth for absolute paths.
- Committed: a `linked:` list in a member's `.warpforge/workspace.yaml`, with
  paths relative to that repository (`../infra`, `../k8s-schemas`). On load the
  daemon resolves each one; a path that is a registered project joins the
  space as that project, any other existing directory joins as a loose
  folder, a missing path is reported and skipped. A committed `linked:` list
  creates the space when none exists, named after the declaring project.

**The task's own project stays primary.** cwd, the worktree, services,
runtime context, Keepers and the pull request are the primary project's, as
today. ADR 0030's "one task, one PR" holds: phase 1 commits in sibling
repositories are the agent's own business and are not tracked by Warpforge.

**Siblings reach the agent two ways.**
1. As ACP `additionalDirectories` on `session/new` and `session/load`, when
   the agent advertises the capability. Each path is canonicalised, and the
   realpath is sent alongside a symlinked path, because adapters' sandboxes
   check realpaths.
2. As a `<workspace_folders>` block in the runtime context
   (`actor/project.rs` `runtime_context`): name, whether it is a git
   checkout, absolute path, and one instruction — run git and commit inside
   each repository separately. The block is capped at about 3.5 KB (Codex
   truncates context entries over 4 KB) and folder names are sanitised, since
   they come from user-controlled directory names.
   Agents without the capability get the block only.

**The folder list is a snapshot taken when the task is created.** It is stored
on the task and sent byte-identical on every `session/load`, like
`_meta.systemPrompt` (ADR 0027, invariant 4): a list that changed between
turns would rebuild the Claude session and lose its context. Editing a space
affects new tasks. A later "refresh folders" action may rebuild a session
deliberately.

**Siblings are used at their main checkout in phase 1.** A task's worktree
covers only the primary project; edits in siblings land in their main
checkouts and are shared with every other task of the space. This is the
known cost of phase 1 and is said in the UI where folders are listed.

**No read-only member.** Neither ACP nor the adapters can grant read access
to one folder and write access to another, and anything the agent runs in a
shell bypasses whatever the daemon could check. Offering a "read-only" toggle
would promise a guarantee Warpforge cannot keep.

**ADR 0017 path confinement is unchanged.** Client file RPCs stay confined to
the task's root. The Explorer does not browse sibling folders in phase 1.

**The desktop shows a space through project mode (ADR 0033).** A space is a
scope with several projects (`panelScope: { kind: "space"; id }`): its panel
lists the member projects, each opening that project's mode, and the loose
folders as plain rows, then the tasks of all member projects grouped by
project. A project in a space shows an "in <space>" link back to it. Sections
stay per project rather than being repeated for every member. A space can be
pinned to the rail like a project. New Task inside a space asks for the
primary project, defaulting to the one you came from. A task with sibling
folders shows "+N repos" in the title row, listing what its agent was given
(`TaskInfo.workspaceFolders`). Settings → Spaces & repos edits spaces and marks
members that come from `linked:` (`ProjectInfo.linked`, resolved paths).

## Invariants

1. **The primary project owns the task.** (`daemon/task.rs`, keepers, PR
   status) Nothing keys a worktree, service, keeper run or pull request on a
   sibling.
2. **`additionalDirectories` is byte-stable for a session's life.**
   (`acp/session/init.rs`) `session/new` and `session/load` send the task's
   stored snapshot, never a fresh resolution of the space.
3. **Send the field only to agents that advertise it.** An agent that did not
   declare `sessionCapabilities.additionalDirectories` gets the prompt block
   only; an unknown field must not fail its session.
4. **A missing or unreadable member is skipped and reported, never fatal.** A
   task starts without that folder.
5. **One space per project.** Adding a project that is already in a space is
   refused with the space's name.
6. **The prompt block stays under the cap and carries sanitised names.**

## Phases

1. Spaces data (`spaces.json`, `linked:` in `workspace.yaml`), the snapshot
   on tasks, `additionalDirectories` + prompt block, space in project mode,
   space pins. *(this record)*
2. Per-repository sections in the Changes rail and diff for siblings.
3. Optional per-task worktrees for sibling repositories, one task folder
   holding every repository's worktree.
