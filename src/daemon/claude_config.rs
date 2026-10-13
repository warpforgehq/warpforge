//! Which Claude config directory warpforge works against: the `claude:`
//! section of `~/.warpforge/config.yaml`.
//!
//! ```yaml
//! claude:
//!   config_dir: ~/.claude-work
//! ```
//!
//! The Claude CLI keeps its login, settings, skills and session history in one
//! directory — `CLAUDE_CONFIG_DIR`, else `~/.claude`. People who keep several
//! (a work one and a personal one) pick between them with that variable in
//! their shell, which an app launched from the Dock never sees. This setting
//! names the directory once, for the whole daemon.
//!
//! Precedence: this setting, then the daemon's own `CLAUDE_CONFIG_DIR`, then
//! `~/.claude`. The value must be absolute or start with `~/`; anything else
//! is ignored, because the CLI would resolve a relative path against each
//! task's working directory and land in a different place per project.
//!
//! Invariant: everything that touches the Claude CLI's state — agent spawns,
//! credentials and account switching, quota polling, the resumable-session
//! list — resolves the directory through [`config_dir`]. A caller that joins
//! `~/.claude` itself reads a different account than the agents run as, and
//! nothing reports the mismatch: the quota widget simply shows another
//! account's numbers. The one exception is a resume: a session's transcript
//! lives in the dir it was started in, so a task records that dir and goes
//! back to it ([`recorded`]) even after this setting changed.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Deserialize;

/// The `claude:` block. Missing keys mean "not configured".
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ClaudeConfig {
    #[serde(default)]
    pub config_dir: Option<String>,
}

impl ClaudeConfig {
    /// The file is read on every call, so an edit applies to the next spawn
    /// without restarting the daemon; only the parse is skipped while its text
    /// is unchanged. Keyed by content rather than mtime, so an edit can never be
    /// missed for landing within the timestamp's resolution.
    pub fn load() -> Self {
        match std::fs::read_to_string(super::config_file::path()) {
            Ok(raw) => Self::parsed(raw),
            Err(_) => Self::default(),
        }
    }

    /// The `claude:` section of `raw`, reusing the last parse for the same text.
    fn parsed(raw: String) -> Self {
        static LAST: Mutex<Option<(String, ClaudeConfig)>> = Mutex::new(None);
        let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((text, config)) = last.as_ref() {
            if *text == raw {
                return config.clone();
            }
        }
        let config: Self = super::config_file::parse_section(&raw, "claude");
        *last = Some((raw, config.clone()));
        config
    }
}

/// A resolved Claude config directory.
#[derive(Debug, Clone, PartialEq)]
pub struct ClaudeDir {
    pub path: PathBuf,
    /// Chosen by the user (this setting or `CLAUDE_CONFIG_DIR`) rather than
    /// the CLI's default. The CLI then keeps `.claude.json` inside the
    /// directory instead of next to it, and agents must be told the path.
    pub explicit: bool,
}

/// The Claude config directory the daemon and its agents use right now.
pub fn config_dir() -> ClaudeDir {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let env = std::env::var("CLAUDE_CONFIG_DIR").ok();
    let (dir, ignored) = resolve(
        ClaudeConfig::load().config_dir.as_deref(),
        env.as_deref(),
        &home,
    );
    if let Some(raw) = ignored {
        warn_once(&raw);
    }
    dir
}

/// A dir recorded earlier — the one a task's session was started in. Its
/// explicitness is recorded with it: `~/.claude` named by the daemon's own
/// `CLAUDE_CONFIG_DIR` is explicit to the CLI (scoped keychain item,
/// colocated `.claude.json`), so it cannot be re-derived from the path.
/// `None` is a row written before that was stored, classified as a
/// configured value would be.
pub fn recorded(path: &str, explicit: Option<bool>) -> ClaudeDir {
    let path = PathBuf::from(path);
    let explicit = explicit.unwrap_or_else(|| {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        path != home.join(".claude")
    });
    ClaudeDir { path, explicit }
}

/// The directory, plus the configured value when it had to be ignored.
///
/// The two sources are treated differently on purpose. The setting is ours:
/// it is normalised, and agents are handed exactly the normalised string. The
/// environment value is the one the user's own `claude` runs with, and the
/// CLI derives its keychain item from that exact string — with a trailing
/// slash or a `/./` it reports "not logged in" for the very same directory.
/// So it is used verbatim; tidying it would point us at a login that does not
/// exist.
pub(crate) fn resolve(
    configured: Option<&str>,
    env: Option<&str>,
    home: &Path,
) -> (ClaudeDir, Option<String>) {
    let mut ignored = None;
    if let Some(raw) = configured.map(str::trim).filter(|v| !v.is_empty()) {
        match expand(raw, home) {
            // The default spelled out is still the default. Marking it explicit
            // would hand agents `CLAUDE_CONFIG_DIR=~/.claude`, and the CLI would
            // then look for a scoped keychain item and a colocated
            // `.claude.json` — neither of which the user's own `claude` writes.
            Some(path) => {
                let explicit = path != home.join(".claude");
                return (ClaudeDir { path, explicit }, None);
            }
            None => ignored = Some(raw.to_string()),
        }
    }
    let dir = match env.filter(|v| !v.trim().is_empty()) {
        Some(raw) => ClaudeDir {
            path: PathBuf::from(raw),
            explicit: true,
        },
        None => ClaudeDir {
            path: home.join(".claude"),
            explicit: false,
        },
    };
    (dir, ignored)
}

/// Say once per bad value, not on every call: the directory is resolved on
/// each quota poll and spawn, and a repeated line buries the log.
fn warn_once(raw: &str) {
    static LAST: Mutex<Option<String>> = Mutex::new(None);
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if last.as_deref() != Some(raw) {
        eprintln!("[claude] ignoring claude.config_dir {raw:?}: use an absolute path or ~/…");
        *last = Some(raw.to_string());
    }
}

/// `~` / `~/…` against `home`; trailing slashes dropped, so the path we hash
/// for the keychain item and the one we hand the CLI are the same string.
fn expand(raw: &str, home: &Path) -> Option<PathBuf> {
    let path = if raw == "~" {
        home.to_path_buf()
    } else if let Some(rest) = raw.strip_prefix("~/") {
        home.join(rest)
    } else {
        PathBuf::from(raw)
    };
    let path = PathBuf::from(path.to_string_lossy().trim_end_matches('/'));
    path.is_absolute().then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOME: &str = "/Users/tester";

    fn resolved(configured: Option<&str>, env: Option<&str>) -> ClaudeDir {
        resolve(configured, env, Path::new(HOME)).0
    }

    #[test]
    fn setting_wins_over_env_and_default() {
        let dir = resolved(Some("~/.claude-work"), Some("/elsewhere"));
        assert_eq!(dir.path, PathBuf::from("/Users/tester/.claude-work"));
        assert!(dir.explicit);
    }

    #[test]
    fn env_applies_when_nothing_is_configured() {
        let dir = resolved(None, Some("/opt/claude"));
        assert_eq!(dir.path, PathBuf::from("/opt/claude"));
        assert!(dir.explicit);
    }

    /// The CLI keys its keychain item on the exact string: a tidied copy of
    /// `/opt/claude/` would be a directory with no login.
    #[test]
    fn env_value_is_used_verbatim() {
        for raw in ["/opt/claude/", "/opt/./claude", " /opt/claude"] {
            assert_eq!(resolved(None, Some(raw)).path, PathBuf::from(raw));
        }
    }

    #[test]
    fn default_is_home_dot_claude_and_not_explicit() {
        let dir = resolved(Some("  "), Some(" "));
        assert_eq!(dir.path, PathBuf::from("/Users/tester/.claude"));
        assert!(!dir.explicit);
    }

    #[test]
    fn the_default_spelled_out_is_not_explicit() {
        for value in ["~/.claude", "/Users/tester/.claude/"] {
            let dir = resolved(Some(value), None);
            assert_eq!(dir.path, PathBuf::from("/Users/tester/.claude"));
            assert!(!dir.explicit, "{value}");
        }
    }

    #[test]
    fn relative_setting_is_ignored_and_reported() {
        let (dir, ignored) = resolve(Some(" .claude-work "), Some("/opt/claude"), Path::new(HOME));
        assert_eq!(dir.path, PathBuf::from("/opt/claude"));
        assert_eq!(ignored.as_deref(), Some(".claude-work"));
        let (dir, ignored) = resolve(Some("/"), None, Path::new(HOME));
        assert_eq!(dir.path, PathBuf::from("/Users/tester/.claude"));
        assert_eq!(ignored.as_deref(), Some("/"));
        assert_eq!(resolve(Some("~/w"), None, Path::new(HOME)).1, None);
    }

    #[test]
    fn trailing_slash_is_dropped() {
        let dir = resolved(Some("/opt/claude-work/"), None);
        assert_eq!(dir.path, PathBuf::from("/opt/claude-work"));
    }

    #[test]
    fn reads_the_claude_section_and_follows_every_edit() {
        let work = "memory:\n  embedding: fastembed\nclaude:\n  config_dir: ~/.claude-work\n";
        assert_eq!(
            ClaudeConfig::parsed(work.into()).config_dir.as_deref(),
            Some("~/.claude-work")
        );
        // Same text again: the cached parse.
        assert_eq!(
            ClaudeConfig::parsed(work.into()).config_dir.as_deref(),
            Some("~/.claude-work")
        );
        // Any change is picked up, including the section disappearing.
        let other = work.replace("claude-work", "claude-other");
        assert_eq!(
            ClaudeConfig::parsed(other).config_dir.as_deref(),
            Some("~/.claude-other")
        );
        assert!(
            ClaudeConfig::parsed("memory:\n  embedding: fastembed\n".into())
                .config_dir
                .is_none()
        );
    }
}
