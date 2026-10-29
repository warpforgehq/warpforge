# 0029 — A chat is a task with no project, run in its own folder

**Status:** accepted (2026-10-29)

## Context

Some agent work has no codebase yet: a question, a draft, a script to try. A
task needs a registered project, and #141 made a task whose project is unknown
stop instead of running in the daemon's working directory. People wanted to
start that work without inventing a project for it, and move it into one later.

## Decisions

**A chat is marked by `tasks.kind = 'chat'`, not by an empty project.** The
column defaults to `task`. A task whose project was removed also has a project
no registry entry matches; marking chats by an empty or unknown project would
let such a task run as a chat, in the wrong place. A chat's `project` is empty.
*Rejected:* `project = ""` as the marker — collides with removed projects.

**A chat runs in `<data dir>/scratch/<task id>/`, created with the chat.** No
worktree, workflow, Factory, runtime context or services. `task_repo_path`
answers the folder for a chat, so session start, the Explorer, file reads and
writes, and the terminal resolve it like any other root (ADR 0017's
`resolve_in_root` still applies under it).
*Rejected:* a temporary directory — macOS purges it, and the user's files go.

**Chats are refused when the data dir sits inside a git checkout.** Git walks
up from the folder; an agent running `git commit` in a chat would commit into
whatever repository contains it — a dotfiles repo in `$HOME`, typically.
`task.create` answers with the reason instead of creating the chat.

**The bridge confines a chat, not the daemon's board RPCs.** The daemon marks
the session with `WARPFORGE_SESSION_KIND=chat` / `WF_KIND=chat` (ADR 0018). The
bridge then refuses backlog, Factory, automation and runtime tools, refuses a
project-scoped `memory_store`, narrows memory search and list to global, and
never falls back to the project its working directory sits in.
*Rejected:* checking in each board RPC — they do not know which session called.

**A chat's folder is deleted only when the user says so.** Deleting a chat
removes an empty folder; one holding files goes only with `task.delete
{ delete_folder: true }`, which the confirmation's checkbox sends (on by
default). Bulk deletes never send it.

**Continuing in a project is the existing continue flow.** It creates a new task
in the chosen project from the transcript or a handoff summary; the chat stays.

## Invariants

1. **Nothing decides "chat" from the project name.** Use `kind`
   (`Daemon::is_chat`, desktop `isChat`).
2. **A chat never inherits a worktree.** `worktree_request` drops a
   `branched-from` source that is a chat (`actor/session.rs`): its folder is not
   a checkout. Tested in `server/tests/chats.rs`.
3. **The scratch root is checked against enclosing checkouts before a chat is
   created** (`scratch::create`, `dispatch/chats.rs`).
4. **A folder holding files is removed only on an explicit `delete_folder`.**
   (`scratch::remove`)
