# 0035 — The project config is edited in place, from the UI or by hand, through one daemon writer

**Status:** accepted (2026-11-27) · backlog #167 · builds on 0033 (project mode), 0034 (spaces)

## Context

A project's committed config (`.warpforge/workspace.yaml`, or a legacy root
`.warpforge.yaml` / `.wf.yaml` / `.workspace.yaml`) declares services, port
forwards, the port range, worktree setup, agent templates and `linked:`
siblings. Today it can be changed only by editing the file: the desktop has no
form for any of it, and the daemon picks up edits by polling the file every
250 ms (`actor/config_observer.rs`).

Three writers already exist, and none is safe to build on:

- `generate_workspace_yaml` (`config.rs`) writes a fresh file on `project.add`
  when none exists, via `serde_yaml`.
- `bootstrap.readConfig` / `bootstrap.writeConfig` write a raw string with no
  validation, no concurrency check and no atomic rename. The desktop never
  calls them.
- `file.save` from the Files editor and agents editing the file directly; both
  are last-write-wins.

A `serde_yaml` round-trip drops comments, key order and unknown keys, and the
same pattern in `memory_config.rs` silently replaces an unparsable file with
an empty mapping. No mature comment-preserving YAML editor exists for Rust;
the TypeScript `yaml` package (Document API) preserves comments, key order
and style and is already in the lockfile transitively.

A machine-local overlay already exists: `<config>.local.yaml` next to the
active file, deep-merged over it (`config_local/`), gitignored automatically,
with per-field `local` markers sent to clients.

## Decisions

**The file stays the source of truth.** The UI is a view and editor of the
active config file and its local overlay, not a copy in app state. Whatever is
in the file after a save, a hand edit, an agent's edit or a `git checkout` is
what the UI shows. *Rejected:* settings kept in app state with an
"import from file" action — configs are shared with a team through git, and a
copy in the app drifts from the file.

**The desktop edits text; the daemon writes it.** The desktop loads the raw
text, applies each form change to a `yaml` Document (`setIn` / `deleteIn`),
and sends the whole new text. The daemon owns the write:

1. resolves the target itself (`find_config_file` for the shared file, the
   matching `.local.yaml` for the overlay) — the client never sends a path
   (ADR 0017);
2. compares the client's `base` fingerprint with the file on disk and refuses
   on mismatch (compare-and-swap);
3. validates the text with the same loader the observer uses, and refuses on
   error;
4. writes atomically (temp file + rename), then applies and broadcasts at
   once instead of waiting for the next poll.

*Rejected:* structured patch RPCs applied in Rust — there is no Rust crate
that can apply them without losing comments.

**Each change is recorded as a path operation and replayed on conflict.**
When the file changes under a dirty form, the desktop reloads the new text
and replays the pending operations onto it. Only an operation whose path also
changed on disk is a conflict; the form shows both values and asks.

**A broken file is shown, not hidden.** The daemon sends a `config_error`
(file, line, message) for the shared file as it already does for the local
one, keeps the last valid state running, and the form turns read-only with
"Open file" until the file parses again.

**Saves go to the file that is active, and never shadow it.** A project on a
legacy file name keeps it. The UI creates `.warpforge/workspace.yaml` only
when no config file exists. Moving a legacy file is a separate, explicit
action.

**Every field shows where its value comes from and where it will be saved.**
Values from the overlay carry a "Only me" marker (the existing `local_fields`).
A section's save target is chosen per edit: *Shared* (committed file) or *Only
me* (overlay). Environment values default to *Only me*; values whose key looks
like a secret (`TOKEN`, `SECRET`, `KEY`, `PASSWORD`) warn before a shared save.

**Saving does not restart services.** A service whose command, port or env
changed is marked "restart to apply" (today's observer behaviour, now
visible). Removing a service in the form stops it, so the form says so before
saving.

**The editor is a full page in project mode.** A "Config" section in the
project panel (ADR 0033) fills the main area, like Backlog or Runtime; "Edit
project" in the project context menu opens it. A dialog was rejected: adding
services, env and port forwards needs room. The page groups Services, Port
forwards, Ports, Worktree, Agent templates and Linked repos, and has "Open
file" for the raw text in the Files editor. Project name and path stay
registry edits; the file's `name:` is not tied to them.

## Invariants

1. **One writer.** Every UI save goes through the daemon's config write RPC.
   Nothing in the desktop writes the config file with `file.save`.
2. **No serde round-trip on save.** The saved text is the user's text plus the
   edited nodes. A test saves a file with comments and an unknown key and
   asserts both survive.
3. **Compare-and-swap on every write.** A write whose base fingerprint does
   not match the file is refused, never merged on the daemon side.
4. **Never write a file that fails to load**, and never replace an unreadable
   file with defaults.
5. **Never create a config file that shadows an existing one.**
6. **The client sends no path.** The daemon picks the shared or local file
   from the project and a scope flag.

## Consequences

- `bootstrap.readConfig` / `bootstrap.writeConfig` are replaced by the new
  read and write RPCs.
- The read RPC returns, for both files, the raw text, its fingerprint and its
  path, plus fields the clients do not receive today (env, healthcheck,
  `readyPattern`, `dependsOn`, worktree, the written port range).
- `yaml` becomes a direct desktop dependency (and a `www` dependency if a
  component that uses it is embedded in the docs site).
- Edits land in the main checkout. Running tasks' worktrees keep their own
  committed copy until the change is committed and merged.
