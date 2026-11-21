//! Agent registry: detect installed ACP-capable CLIs, report install/update
//! state, and persist the user's enabled set to SQLite. Agents are globally
//! installed binaries (npm/brew) that speak ACP over stdio; the daemon spawns
//! them directly (no `npx` — a first-run npx download used to truncate and
//! wedge the session, see HANDOFF.md).

use std::collections::HashMap;

use warpforge_protocol as wire;

mod antigravity;
mod detect;
mod manage;

pub(crate) use antigravity::{expose_managed_bin, finish_sign_in, start_sign_in};

pub(crate) use detect::{
    compare_versions, first_version_token, latest_npm_version, npm_global_version,
    package_manager_for_path, probe, which, PackageManager, PROBE_TIMEOUT,
};
pub use detect::{detect_agents, detect_agents_local};
pub use manage::run_manage_command;
pub(crate) use manage::{
    broken_install, broken_install_summary, install_agent, InstallError, InstallRequest,
};

/// A known ACP-capable agent the daemon can detect and manage.
pub struct KnownAgent {
    pub id: &'static str,
    pub display_name: &'static str,
    /// Binary name checked on PATH and spawned.
    pub binary: &'static str,
    /// Default ACP server command (passed to `sh -c`).
    pub default_acp_command: &'static str,
    /// npm package that provides the binary (None for brew-only agents).
    pub npm_package: Option<&'static str>,
    /// Extra npm packages to co-install/co-update alongside `npm_package`
    /// (e.g. an ACP bridge's target harness). Empty for most agents.
    pub extra_npm_packages: &'static [&'static str],
    /// Homebrew formula, when brew is the canonical install (None otherwise).
    pub homebrew_formula: Option<&'static str>,
    /// A self-managed install (e.g. opencode's own `~/.opencode/bin`) that ships
    /// its own upgrade command. Set when the binary is neither npm- nor
    /// brew-managed and cannot be upgraded via the package manager.
    pub custom_upgrade_command: Option<&'static str>,
    /// Human-readable install hint shown when the agent is missing.
    pub install_hint: &'static str,
}

pub static KNOWN_AGENTS: &[KnownAgent] = &[
    KnownAgent {
        id: "claude",
        display_name: "Claude Code",
        binary: "claude-agent-acp",
        default_acp_command: "claude-agent-acp --acp",
        npm_package: Some("@agentclientprotocol/claude-agent-acp"),
        extra_npm_packages: &[],
        homebrew_formula: None,
        custom_upgrade_command: None,
        install_hint: "npm install -g @agentclientprotocol/claude-agent-acp",
    },
    KnownAgent {
        id: "codex",
        display_name: "Codex",
        binary: "codex-acp",
        default_acp_command: "codex-acp",
        npm_package: Some("@agentclientprotocol/codex-acp"),
        extra_npm_packages: &[],
        homebrew_formula: None,
        custom_upgrade_command: None,
        install_hint: "npm install -g @agentclientprotocol/codex-acp",
    },
    KnownAgent {
        id: "opencode",
        display_name: "OpenCode",
        binary: "opencode",
        default_acp_command: "opencode acp",
        npm_package: Some("opencode-ai"),
        extra_npm_packages: &[],
        homebrew_formula: None,
        custom_upgrade_command: Some("opencode upgrade"),
        install_hint: "npm install -g opencode-ai",
    },
    KnownAgent {
        id: "qwen",
        display_name: "Qwen Code",
        binary: "qwen",
        default_acp_command: "qwen --acp",
        npm_package: Some("@qwen-code/qwen-code"),
        extra_npm_packages: &[],
        homebrew_formula: None,
        custom_upgrade_command: None,
        install_hint: "npm install -g @qwen-code/qwen-code",
    },
    KnownAgent {
        id: "goose",
        display_name: "Goose",
        binary: "goose",
        default_acp_command: "goose acp",
        npm_package: None,
        extra_npm_packages: &[],
        homebrew_formula: Some("block-goose-cli"),
        custom_upgrade_command: None,
        install_hint: "brew install block-goose-cli",
    },
    KnownAgent {
        id: "junie",
        display_name: "Junie",
        binary: "junie",
        default_acp_command: "junie --acp true",
        npm_package: Some("@jetbrains/junie-cli"),
        custom_upgrade_command: None,
        extra_npm_packages: &[],
        homebrew_formula: None,
        install_hint: "npm install -g @jetbrains/junie-cli",
    },
    KnownAgent {
        id: "cursor",
        display_name: "Cursor",
        binary: "cursor-agent-acp",
        default_acp_command: "cursor-agent-acp",
        npm_package: Some("@blowmage/cursor-agent-acp"),
        custom_upgrade_command: None,
        extra_npm_packages: &[],
        homebrew_formula: None,
        install_hint: "npm install -g @blowmage/cursor-agent-acp",
    },
    KnownAgent {
        id: "pi",
        display_name: "Pi",
        binary: "pi-acp",
        default_acp_command: "pi-acp",
        npm_package: Some("pi-acp"),
        custom_upgrade_command: None,
        extra_npm_packages: &["@earendil-works/pi-coding-agent"],
        homebrew_formula: None,
        install_hint:
            "npm install -g @earendil-works/pi-coding-agent pi-acp (pi needs Node >=22.19)",
    },
    KnownAgent {
        id: "grok",
        display_name: "Grok Build",
        binary: "grok",
        default_acp_command: "grok agent stdio",
        npm_package: Some("@xai-official/grok"),
        custom_upgrade_command: Some("grok update"),
        extra_npm_packages: &[],
        homebrew_formula: None,
        install_hint:
            "curl -fsSL https://x.ai/cli/install.sh | bash (or npm install -g @xai-official/grok)",
    },
    KnownAgent {
        id: "antigravity",
        display_name: "Google Antigravity",
        binary: "agy",
        default_acp_command: "agy acp",
        npm_package: None,
        extra_npm_packages: &[],
        homebrew_formula: None,
        custom_upgrade_command: None,
        install_hint: "Install agy >=1.5: https://antigravity.google/docs/getting-started",
    },
];

pub fn known_agent(id: &str) -> Option<&'static KnownAgent> {
    KNOWN_AGENTS.iter().find(|a| a.id == id)
}

/// Reconcile the persisted agent config against the known registry so the UI
/// always presents every known agent in canonical (registry) order — even when
/// the stored config is stale or partial (e.g. agents installed but never
/// saved). Persisted fields (enabled, models, lastModel, acpCommand) are kept
/// when present; agents not in the registry anymore are dropped.
pub fn reconcile_agents_config(stored: &[wire::AgentConfig]) -> Vec<wire::AgentConfig> {
    let by_id: HashMap<&str, &wire::AgentConfig> =
        stored.iter().map(|a| (a.id.as_str(), a)).collect();
    KNOWN_AGENTS
        .iter()
        .map(|k| match by_id.get(k.id) {
            Some(cfg) => (*cfg).clone(),
            None => wire::AgentConfig {
                id: k.id.to_string(),
                display_name: k.display_name.to_string(),
                acp_command: k.default_acp_command.to_string(),
                enabled: false,
                models: vec![],
                last_model: None,
            },
        })
        .collect()
}

/// Migrate a stored agent command off the retired `npx …@latest` launch path
/// to the current global-binary command. Returns the rewritten command when a
/// migration applies, else None (leave the stored command untouched).
pub fn migrate_npx_command(id: &str, current: &str) -> Option<String> {
    if !current.contains("npx") {
        return None;
    }
    let agent = known_agent(id)?;
    (agent.default_acp_command != current).then(|| agent.default_acp_command.to_string())
}
