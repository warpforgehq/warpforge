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
//! back to it ([`pinned`]) even after this setting changed.

use std::path::{Path, PathBuf};

use serde::Deserialize;

/// The `claude:` block. Missing keys mean "not configured".
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ClaudeConfig {
    #[serde(default)]
    pub config_dir: Option<String>,
}

impl ClaudeConfig {
    /// Read on every call rather than cached, so an edit to `config.yaml`
    /// applies to the next spawn without restarting the daemon.
    pub fn load() -> Self {
        load_from(&config_path())
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
    resolve(
        ClaudeConfig::load().config_dir.as_deref(),
        env.as_deref(),
        &home,
    )
}

/// A dir recorded earlier — the one a task's session was started in —
/// classified the same way a configured one is.
pub fn pinned(path: &str) -> ClaudeDir {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let path = PathBuf::from(path);
    let explicit = path != home.join(".claude");
    ClaudeDir { path, explicit }
}

pub(crate) fn resolve(configured: Option<&str>, env: Option<&str>, home: &Path) -> ClaudeDir {
    if let Some(raw) = configured.map(str::trim).filter(|v| !v.is_empty()) {
        match expand(raw, home) {
            // The default spelled out is still the default. Marking it explicit
            // would hand agents `CLAUDE_CONFIG_DIR=~/.claude`, and the CLI would
            // then look for a scoped keychain item and a colocated
            // `.claude.json` — neither of which the user's own `claude` writes.
            Some(path) => {
                let explicit = path != home.join(".claude");
                return ClaudeDir { path, explicit };
            }
            None => eprintln!(
                "[claude] ignoring claude.config_dir {raw:?}: use an absolute path or ~/…"
            ),
        }
    }
    if let Some(raw) = env.map(str::trim).filter(|v| !v.is_empty()) {
        return ClaudeDir {
            path: PathBuf::from(raw),
            explicit: true,
        };
    }
    ClaudeDir {
        path: home.join(".claude"),
        explicit: false,
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

fn load_from(path: &Path) -> ClaudeConfig {
    #[derive(Deserialize)]
    struct RawConfig {
        #[serde(default)]
        claude: ClaudeConfig,
    }
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_yaml::from_str::<RawConfig>(&raw).ok())
        .map(|raw| raw.claude)
        .unwrap_or_default()
}

fn config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".warpforge")
        .join("config.yaml")
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOME: &str = "/Users/tester";

    fn resolved(configured: Option<&str>, env: Option<&str>) -> ClaudeDir {
        resolve(configured, env, Path::new(HOME))
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

    #[test]
    fn default_is_home_dot_claude_and_not_explicit() {
        let dir = resolved(Some("  "), Some(""));
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
    fn relative_setting_is_ignored() {
        let dir = resolved(Some(".claude-work"), None);
        assert_eq!(dir.path, PathBuf::from("/Users/tester/.claude"));
    }

    #[test]
    fn trailing_slash_is_dropped() {
        let dir = resolved(Some("/opt/claude-work/"), None);
        assert_eq!(dir.path, PathBuf::from("/opt/claude-work"));
    }

    #[test]
    fn reads_the_claude_section_and_tolerates_its_absence() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("config.yaml");
        std::fs::write(
            &path,
            "memory:\n  embedding: fastembed\nclaude:\n  config_dir: ~/.claude-work\n",
        )
        .unwrap();
        assert_eq!(
            load_from(&path).config_dir.as_deref(),
            Some("~/.claude-work")
        );

        std::fs::write(&path, "memory:\n  embedding: fastembed\n").unwrap();
        assert!(load_from(&path).config_dir.is_none());
        assert!(load_from(&tmp.path().join("missing.yaml"))
            .config_dir
            .is_none());
    }
}
