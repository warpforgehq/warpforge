# 0026 — Claude accounts as profiles: one config directory per account

**Status:** proposed (2026-10-14) · builds on `warpforgehq/warpforge#53` ·
open questions for the maintainer at the end

## Context

Warpforge manages agent accounts two opposite ways.

- **Codex: one home per account.** Each account is a vault under
  `~/.warpforge/accounts/codex/<slug>/`, and the agent runs with
  `CODEX_HOME=<vault>`. `materialize_codex_home` links everything that is not
  account-specific (config, MCP servers, sessions) back to `~/.codex`, so only
  `auth.json` and the model cache are private.
- **Claude: one directory, credentials swapped in place.** `claude_auth`
  rejected a config dir per account because it would fragment skills,
  plugins, settings and history. A switch captures the outgoing login and
  writes the target's credentials and `oauthAccount` into the one live
  directory.

Swapping works when the accounts differ only by token. Work accounts usually
don't. A Claude config directory holds more account-bound state than the
login:

| Entry | Bound to |
| --- | --- |
| keychain item `Claude Code-credentials-<sha256(dir)[..8]>` | the login |
| `.claude.json` — `oauthAccount`, **user-scope MCP servers**, per-project state | the login, partly the user |
| `remote-settings.json`, `policy-limits.json` | the login's organisation (managed policy) |
| `projects/` (transcripts), `history.jsonl`, `sessions/`, `todos/` | whoever ran the sessions |
| `settings.json`, `skills/`, `plugins/`, `CLAUDE.md`, `agents/`, `commands/` | the user, not the account |

A credential swap moves the first row and part of the second; the managed
policy and the transcripts stay with the directory. With swapping, a personal
login can run under an organisation's managed settings, and vice versa.
Swapping also allows only one active Claude account at a time, and a switch
retires every live Claude session (`retire_sessions_for_agent`).

People who keep work and personal Claude separate already do it with
directories, by hand. They set `CLAUDE_CONFIG_DIR=~/.claude-work` in a shell
alias and symlink `settings.json`, `skills`, `plugins` and `CLAUDE.md` back to
`~/.claude`. That is `materialize_codex_home` done manually.

PR #53 gives the daemon the minimum it needs to run Claude elsewhere:
- **`claude.config_dir` in `config.yaml`**, resolved by
  `claude_config::config_dir()`;
- **a per-task record** of the directory a session started in
  (`tasks.claude_config_dir` / `claude_config_explicit`), so a resume goes
  back to its transcript;
- **a `ClaudeRuntime` that reads and writes only its own directory's scoped
  keychain item**.

PR #53 still assumes one directory at a time.

## Options

### A. Named directories, chosen in Settings

Settings lists Claude directories. It discovers `~/.claude*` and any
`CLAUDE_CONFIG_DIR=` in the user's shell rc files, and lets the user add one
by path. Each directory gets a name, and one is active. Choosing one is the
UI for `claude.config_dir`.

- **+** Small: a list and a selector over what #53 already resolves.
- **+** Warpforge never creates directories or decides which files are shared.
- **+** Existing setups like the one above need no migration.
- **−** Still one active directory, and switching is global.
- **−** Creating a directory and its symlinks stays manual.

### B. Profiles that Warpforge creates and owns

"Add Claude account" asks for a name. Warpforge then creates the directory,
links the shared entries into it, and opens the embedded terminal with
`CLAUDE_CONFIG_DIR=<dir> claude` to sign in. The profile appears once the
login lands.

- **+** Accounts sit side by side instead of being swapped. Two tasks can run
  on two accounts at once, and every profile's quota is visible at once.
- **+** Organisation policy and transcripts are isolated by construction.
- **+** Switching becomes a pointer change. The capture-before-overwrite rules
  in `credential_capture`, which exist only because swapping overwrites a
  live login, stop being on the hot path.
- **−** **Shared files.** Warpforge decides which entries are shared, and
  Claude's layout changes between releases.
- **−** **User MCP servers.** They live in `.claude.json`, the one file that
  must stay private, so they need their own sync, or a new profile starts
  without them.
- **−** **Reversed decision.** This reverses the decision recorded in
  `claude_auth`, and both account models would coexist for Claude until
  swapping is retired or migrated.

### C. A default profile per project (layers on A or B)

A project names its Claude profile, for example every `kodjin-*` project uses
`work`. New tasks in that project start there. New Task can override the
profile for one task, and the task strip's account menu shows which profile a
task runs on.

- **+** For most people this removes switching entirely.
- **+** Work code cannot start on a personal login by mistake.
- **+** The resume half is already built: #53 records a task's directory and
  goes back to it.
- **−** One more per-project setting, and a defined behaviour when its profile
  is removed.

### Add-ons, any option

- **Status-bar switcher.** The Claude quota strip opens a menu of profiles, each
  with its own quota.
- **Shell alias, opt-in.** Warpforge appends
  `alias claude-<name>='CLAUDE_CONFIG_DIR=… claude'` to the user's rc file, so
  the terminal and Warpforge share profiles.
- **Quota fallback across profiles.** When one profile is exhausted, the runner
  continues on another (ADR 0019 would then choose, not just refuse). Only
  where the project allows it explicitly.

## Proposal

Ship this in phases. Each phase is useful on its own, and only the last one
changes the account model.

1. **#53:** the setting, the resolver and the per-task directory.
2. **A + C:**
   - named directories in Settings and a per-project default;
   - a per-task override at New Task;
   - one `ClaudeRuntime` per known directory, so quota is polled for each.

   Swapping stays as it is, *inside* a directory. A profile can still hold
   several saved logins.
3. **B:** creating a profile and signing in from the UI. This needs a
   maintainer decision on the questions below, and supersedes the
   "not switched by environment" part of `claude_auth`'s module doc.

Rejected for now: dropping swapping in phase 2. It works, people use it, and
A + C does not need it gone.

## Invariants (whichever phase lands)

- **A session resumes where it started.** The directory a task's session
  started in, and whether it was explicit, decide every later resume.
  Profile, project and global settings choose the directory for *fresh*
  sessions only (`claude_dir_for`, #53).
- **State is read through the task's directory, never a global one.** Today
  `claude_config::config_dir()` is global. With more than one directory, any
  per-task reading must go through the task's recorded directory:
  - the quota gate,
  - credential capture after a turn,
  - the account switch,
  - the session list.

  A global read silently reports another account. That is the bug #53 fixed
  for the single-directory case.
- **Paths are stored verbatim.** The CLI keys the keychain item on the exact
  `CLAUDE_CONFIG_DIR` string: `/x/` is not signed in where `/x` is. Normalise
  a profile's path once, when it is created or adopted, and pass that string
  everywhere afterwards.
- **Created profiles share by allow-list.** Codex links everything except a
  list, which is safe there because its private state is two files. Claude's
  private state is spread out and grows between releases, so a created profile
  links only entries known to be per-user. Credentials, `.claude.json`,
  `projects/`, `history.jsonl`, `sessions/`, `remote-settings.json` and
  `policy-limits.json` are never linked.
- **Adopted directories are not vaults.** `verify_vault_under` confines account
  homes to `~/.warpforge/accounts` and refuses symlinks, and that must not be
  loosened for an adopted `~/.claude-work`. An adopted directory is a separate
  kind of record. Warpforge never deletes or rewrites it, beyond what the CLI
  itself would write there.
- **No silent writes outside Warpforge's own files.** Shell rc edits and
  directory creation outside `~/.warpforge` each need the user's consent
  for that action.
- **Work never falls back to personal.** Cross-profile quota fallback is off by
  default and set per project. No default ever moves a run from one
  organisation's profile to another.
- **An agent command that sets `CLAUDE_CONFIG_DIR` defeats all of this.** It is
  applied after the environment the daemon passes, so it overrides every
  profile and every recorded directory (warned since #53). The profile UI
  should flag such a command and offer to remove the prefix.

## Open questions for the maintainer

1. **Phase 3 at all?** Is reversing `claude_auth`'s one-directory decision
   acceptable once phases 1–2 have shipped? If not, phase 2 is the end state.
2. **Where do profiles live?** Options:
   - `config.yaml` (`claude.profiles: {work: ~/.claude-work}`), hand-editable
     and next to `config_dir`;
   - the `agent_accounts` table with a `config_dir` column, so the accounts
     panel, `active_account`, `task.account_id` and quota rows come for free,
     at the cost of a second, non-vault kind of account home.
3. **Per-project default.** It holds machine-local paths, so it belongs in the
   registry (`~/.warpforge/projects.json`) rather than the committed
   `.warpforge/workspace.yaml`. Agreed?
4. **User MCP servers in created profiles.** Copy them once at creation, keep
   them in sync, or leave them to the user?
5. **Quota fallback across profiles.** In scope, or explicitly out?
