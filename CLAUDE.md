
## Project: Warpforge

Workspace orchestrator with a desktop interface. Manages multiple dev projects: isolated services with auto-resolved ports, embedded agent terminals (Codex, Claude), instant context switching.

### Architecture

**Core (Rust):**
- **Language:** Rust
- **Async runtime:** Tokio
- **Daemon:** Background process that manages services, agents, and project state
- **PTY:** `portable-pty` — real TTY for spawned agents
- **Terminal emulation:** `vt100` crate — parses ANSI into screen buffer
- **CLI:** `clap` derive API
- **Config:** `.warpforge/workspace.yaml` per project (serde_yaml; legacy root-level `.warpforge.yaml` / `.wf.yaml` / `.workspace.yaml` still load), registry in `~/.warpforge/projects.json`
- **Port isolation:** each project gets 100-port range (4000+), `${svc.port}` interpolation in env vars
- **Daemon IPC:** WebSocket JSON-RPC (port 61814)

**Binary (Rust):** `cargo build --release` → `target/release/warpforge`. Only
`warpforge daemon` (run by desktop as a sidecar) and the hidden
`__mcp-orchestrator` (spawned by the daemon for orchestrator agents).

**Desktop (TypeScript + Tauri):**
- **Framework:** Tauri v2 (Rust shell + WebView)
- **Frontend:** React 18 + TypeScript + Vite
- **UI:** Tailwind CSS + Radix UI primitives + shadcn/ui components
- **State:** Zustand (persisted to localStorage)
- **Terminal:** CodeMirror for editor, xterm.js for interactive terminal sessions
- **Package manager:** Bun
- **Linting:** oxlint + oxfmt
- **Tests:** Vitest + React Testing Library

**Key crates (Rust):** tokio, clap 4, serde, anyhow, portable-pty 0.8, vt100 0.15

### Source layout (`src/`)

```
main.rs          — CLI entry (clap), subcommands: daemon, __mcp-orchestrator
agent.rs         — AgentManager: PTY spawn via portable-pty, vt100 parser, input/output channels
service.rs       — ServiceManager: sh -c spawn, stdout/stderr log capture, process-group kill, port allocation
config.rs        — workspace config parsing + auto-detect (package.json scripts, docker-compose)
workflow_config.rs — .warpforge/workflows/*.yaml templates: schema, validation, prompt rendering
registry.rs      — ~/.warpforge/projects.json CRUD
ports.rs         — Port range allocation (4000+), ${svc.port} env interpolation
```

**Daemon (`src/daemon/`):**
- WebSocket server (port 61814) that desktop connects to
- Manages agents, services, port-forwards, tasks, git operations
- Key files: server.rs, actor.rs, task.rs, agents.rs, diff.rs
- **workflow.rs** — deterministic workflow pipeline: run state, stage prompts,
  agent protocols. Actor glue is the workflow block at the end of actor.rs.
  Templates are parsed by `src/workflow_config.rs`; see `docs/adr/0001`.

**Desktop source (`desktop/src/`):**
```
main.tsx              — React entry point
App.tsx               — Main app shell, navigation
daemon/               — WebSocket client to Rust daemon (ONLY place that talks to daemon)
protocol.ts           — TypeScript types for daemon protocol (mirrors Rust)
query.ts              — React Query setup
store/
  ui.ts               — Zustand store (UI state: view, panels, toggles)
views/
  MissionControl.tsx  — Main dashboard with session tiles
  Projects.tsx        — Project list + surface tabs (backlog, runtime, files, PRs)
  TaskDetail.tsx      — Task detail: chat + changes rail + runtime panel
  Settings.tsx        — Settings view
components/
  AttentionRail.tsx   — "Needs you" sidebar
  ChangesRail.tsx     — Git staging tree + commit box
  ChatComposer.tsx    — Agent chat input
  ChatTranscript.tsx  — Agent conversation display
  RuntimePanel.tsx    — Services/port-forward status
  CodeEditor.tsx      — CodeMirror editor
  MergeDiff.tsx       — Diff viewer
  FileTree.tsx        — File tree navigator
  + 30 more UI components
hooks/                — React hooks (useChatFollow, useMediaQuery)
lib/                  — Utilities (38 files: sessionActivity, sessionTiming, etc.)
```

### What Works (Rust)

- **Daemon:** `warpforge daemon` — owns all state, serves the WebSocket API desktop connects to
- **Agent PTYs:** portable-pty + vt100 screen buffer per agent
- **Service management:** `sh -c` spawn, log capture, readiness, start/stop/restart
- **Port isolation:** per-project 100-port ranges, env interpolation
- **Process cleanup:** process-group kill (`kill -9 -<pgid>`) for service subtrees, PTY drop on agent kill

### What Works (Desktop)

- **Daemon connection:** WebSocket JSON-RPC client with auto-reconnect, handshake, demo mode
- **Task management:** create, archive, delete, title editing, session resume
- **Agent chat:** conversation stream, composer with mentions/attachments, thinking blocks
- **Changes rail:** staging tree with tri-state checkboxes, per-file diff counts, commit with amend
- **Mission Control:** session tiles with live conversation preview, pinned tasks
- **Backlog:** per-project work item list — infinite scroll, filters, sort, priority edits, detail drawer
- **Services/PF status:** runtime panel with live status/logs, start/stop/restart, and an interactive terminal
- **Git operations:** commit, push (with force-with-lease), branch info
- **Code editor:** CodeMirror with syntax highlighting for multiple languages
- **Diff viewer:** unified/split merge view
- **Agent setup:** detect/install agents (Claude, Codex), bootstrap wizard
- **UI state:** Zustand store with localStorage persistence (panels, toggles, view)
- **Orchestration:** planner → workers → reviewers pipeline (daemon-driven)
- **Workflows:** pick a configured pipeline (`.warpforge/workflows/*.yaml`) in
  New Task; the daemon runs `plan? → implement → review ⇄ fix` as child tasks,
  asks you at barriers (stage question, review limit), and supports
  pause/resume. See `docs/adr/0001-workflow-pipelines.md` before changing it.

### Key Design Decisions

**Read `docs/adr/` before changing a subsystem it covers.** Those records hold
the rejected alternatives and the invariants that are not visible in the code —
each entry's *Invariants* section lists mistakes already made once. Add a new
numbered record when you make a decision a future reader could not infer.

- **portable-pty:** Cross-platform PTY. Reader/writer in `spawn_blocking` tasks, input via `mpsc::unbounded_channel`.
- **Process groups:** Services spawn with `process_group(0)` so `kill -9 -<pgid>` kills sh→npm→node tree.
- **`sh -c "<command>"`** for services — commands can contain pipes, `&&`, `cd`, etc.

### Build & Run

```bash
# Rust daemon (desktop dev builds it as the sidecar)
cargo build --release
# or run it by hand:
cargo run -- daemon

# Desktop (Tauri + React)
cd desktop
bun install
bun run tauri dev
```

### Desktop Commands

```bash
cd desktop
bun run dev          # Vite dev server only
bun run tauri dev    # Full Tauri dev (Rust + frontend)
bun run lint         # oxlint
bun run lint:fix     # oxlint --fix
bun run format       # oxfmt
bun run typecheck    # tsc --noEmit
bun run test         # vitest
```

### Before committing

Run the fast CI checks locally — CI rejects on these and it's avoidable:

- `cargo fmt --all -- --check` (or `cargo fmt --all` to fix)
- `cargo clippy --locked --all-targets -- -D warnings`
- desktop changes: `cd desktop && bun run lint && bun run typecheck`

A pre-commit hook (`.githooks/pre-commit`, enabled via
`git config core.hooksPath .githooks`) runs these; do not rely on it — run them
yourself before committing, and never `--no-verify` to dodge a real failure.

Every commit must carry a changeset (`bun run changeset` produces one — add
it in the same commit as the change). Never hand-edit versions or
`CHANGELOG.md` — the **Version release** workflow owns both. See
`docs/RELEASING.md`.

Changeset text is customer-facing release-note copy. Write it for users, not
maintainers or changelog tooling: lead with outcome and product value, explain
how the feature helps and include a shortcut or action when useful. Use plain,
confident language and describe one coherent user-visible improvement per
changeset; combine related implementation commits when they ship as one
experience. Avoid internal names and implementation details such as RPCs,
packages, daemon processes, file paths, protocol names, or compiler flags.
Mention limitations only when they affect what users can do. Never claim
behavior the product does not provide.

Keep commits small and focused, not huge sweeping changes. Each commit should
briefly describe the essence of what changed (one logical change per commit).

### Module layout

Keep source files small — at most 400–500 lines of code per file. That is the
hard maximum; split larger files rather than growing past it.

Enforce it on the way in, not later. `src/daemon/actor.rs` reached 10,504 lines
because every change added "just one more arm" to a file that was already over
the limit. Adding to a file that is already at the cap is the violation; split
first, then add.

When a module outgrows one file, turn it into a directory module — `foo.rs`
becomes `foo/mod.rs` plus siblings — rather than inventing a `foo_extra.rs`
next to it. Split by topic, not by line count: each file should be nameable
after what it does. `mod.rs` keeps the type definition, its constructor, and a
thin dispatcher; the behaviour lives in the topic files. Child modules can read
private fields of a type defined in the parent, so splitting needs only method
visibility bumps (`pub(super)` / `pub(crate)`), never public fields.

The one acceptable exception is a single item that cannot be divided without
rewriting it — a large `enum` with doc comments, for example. Do not split such
an item just to satisfy the line count.

When a large `match` moves out of one file, keep it exhaustive in one place —
a dispatcher whose arms each call a `pub(crate)` method is the safe shape.
Chaining topic handlers by falling through (`other => self.handle_next(other)`)
with a terminal `_ => {}` compiles the same but turns a dropped arm into a
silent no-op instead of a compile error. `src/daemon/actor/` currently uses that
chained shape, so a new `Command` variant must be wired up by hand — the
compiler will not remind you.

### Clean up after yourself

Write scratch files — scripts, dumps, logs, screenshots — under `$TMPDIR`,
never into the repo. Delete the ones you created before reporting a task done.
Leave files you did not create alone; that directory is shared with other
sessions.
