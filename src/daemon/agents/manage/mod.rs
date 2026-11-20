//! Install/update commands for registry agents: pick the command that matches
//! how the binary was installed, and recognise a broken install.

mod install;
mod run;

pub(crate) use install::{install_agent, InstallError, InstallRequest};
pub use run::run_manage_command;

use super::antigravity;
use super::detect::PackageManager;
use super::KnownAgent;

const ANTIGRAVITY: &str = "antigravity";

/// Append any co-install packages to an install/update command.
fn with_extras(agent: &KnownAgent, base: String) -> String {
    agent
        .extra_npm_packages
        .iter()
        .fold(base, |acc, extra| format!("{acc} {extra}@latest"))
}

/// Append co-install packages, then `--include=optional`. npm can omit an
/// agent's platform optional dependencies, leaving it installed but unable to
/// start; bun/pnpm/brew do not share the failure.
fn npm_with_extras(agent: &KnownAgent, base: &str) -> String {
    format!(
        "{} --include=optional",
        with_extras(agent, base.to_string())
    )
}

/// The shell command that installs (when missing) or updates (when present) an
/// agent, given how its binary is installed. Returns the command string to run
/// via `sh -c`, or None when there is no safe automated path.
pub fn install_command(agent: &KnownAgent) -> Option<String> {
    if agent.id == ANTIGRAVITY {
        return (!cfg!(windows)).then(|| antigravity::MANAGED_LABEL.to_string());
    }
    if let Some(pkg) = agent.npm_package {
        Some(npm_with_extras(
            agent,
            &format!("npm install -g {pkg}@latest"),
        ))
    } else {
        agent.homebrew_formula.map(|f| format!("brew install {f}"))
    }
}

pub(super) fn update_command(agent: &KnownAgent, resolved_path: Option<&str>) -> Option<String> {
    if agent.id == ANTIGRAVITY {
        return resolved_path
            .filter(|path| antigravity::is_managed(path))
            .map(|_| antigravity::MANAGED_LABEL.to_string());
    }
    if let Some(formula) = agent.homebrew_formula {
        // brew-managed agents always update via brew.
        if agent.npm_package.is_none() {
            return Some(format!("brew upgrade {formula}"));
        }
    }
    let pkg = agent.npm_package?;
    let manager = resolved_path.map(super::detect::package_manager_for_path);
    match manager {
        Some(PackageManager::Bun) => Some(with_extras(agent, format!("bun add -g {pkg}@latest"))),
        Some(PackageManager::Pnpm) => Some(with_extras(agent, format!("pnpm add -g {pkg}@latest"))),
        Some(PackageManager::Homebrew) => {
            agent.homebrew_formula.map(|f| format!("brew upgrade {f}"))
        }
        // npm global, or a bare binary name with no path info → assume npm.
        Some(PackageManager::Npm) | None => Some(npm_with_extras(
            agent,
            &format!("npm install -g {pkg}@latest"),
        )),
        // Unrecognised install dir: use the agent's own upgrade command (e.g.
        // opencode's self-installed `~/.opencode/bin`), if it has one.
        Some(PackageManager::Unknown) => agent.custom_upgrade_command.map(|cmd| cmd.to_string()),
    }
}

/// Remove the npm package(s), then install the latest with optional
/// dependencies. npm cannot restore omitted optional dependencies in place.
pub(super) fn clean_install_command(agent: &KnownAgent) -> Option<String> {
    let pkg = agent.npm_package?;
    let mut uninstall = format!("npm uninstall -g {pkg}");
    for extra in agent.extra_npm_packages {
        uninstall.push_str(&format!(" {extra}"));
    }
    let install = npm_with_extras(agent, &format!("npm install -g {pkg}@latest"));
    Some(format!("{uninstall} && {install}"))
}

/// Whether a registry version is a fair baseline for the installed binary: only
/// when the binary is upgradable through that channel.
pub(super) fn registry_is_baseline(update: Option<&str>) -> bool {
    update.is_some()
}

/// Whether a clean reinstall is a valid repair. Only an npm-global install can
/// be repaired this way; a brew, bun, pnpm or self-managed install cannot — a
/// missing agent counts as npm when its registry package is npm-provided.
pub(super) fn can_reinstall(manager: Option<PackageManager>, npm_package: Option<&str>) -> bool {
    match manager {
        Some(PackageManager::Npm) => true,
        None => npm_package.is_some(),
        _ => false,
    }
}

const BROKEN_SIGNATURES: &[&str] = &[
    "missing optional dependency",
    "native binary not found",
    "cannot find module",
    "err_module_not_found",
];

/// Whether a start failure names a broken global install (npm omitted a
/// platform optional dependency, or a module is missing) rather than a config
/// or runtime problem.
pub(crate) fn broken_install(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    BROKEN_SIGNATURES
        .iter()
        .any(|signature| lower.contains(signature))
}

/// The line of a broken-install message that names the failure, for a compact
/// row hint. None when no signature matches.
pub(crate) fn broken_install_summary(text: &str) -> Option<String> {
    text.lines()
        .find(|line| broken_install(line))
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent(id: &str) -> &'static KnownAgent {
        super::super::known_agent(id).unwrap()
    }

    #[test]
    fn self_managed_install_is_not_compared_to_the_registry() {
        // junie on PATH is its own auto-updating launcher under ~/.local/bin and
        // numbers releases on a scheme unrelated to @jetbrains/junie-cli.
        let update = update_command(agent("junie"), Some("/Users/u/.local/bin/junie"));
        assert_eq!(update, None);
        assert!(!registry_is_baseline(update.as_deref()));
    }

    #[test]
    fn npm_managed_install_is_compared_to_the_registry() {
        let update = update_command(
            agent("qwen"),
            Some("/opt/homebrew/lib/node_modules/@qwen-code/qwen-code/bin/qwen.js"),
        );
        assert!(update.is_some());
        assert!(registry_is_baseline(update.as_deref()));
    }

    #[test]
    fn broken_install_recognises_the_real_agent_failures() {
        // claude-agent-acp without its native binary.
        assert!(broken_install(
            "Claude native binary not found for darwin-arm64. Reinstall \
             @anthropic-ai/claude-agent-sdk without --omit=optional, or set \
             CLAUDE_CODE_EXECUTABLE."
        ));
        // codex-acp whose platform package npm omitted.
        assert!(broken_install(
            "Codex process has exited with code 1: Error: Missing optional \
             dependency @openai/codex-darwin-arm64. Reinstall Codex: npm install \
             -g @openai/codex@latest"
        ));
        assert!(broken_install("Error: Cannot find module '@openai/codex'"));
        assert!(broken_install("ERR_MODULE_NOT_FOUND"));
    }

    #[test]
    fn broken_install_ignores_ordinary_failures() {
        assert!(!broken_install(
            "agent rejected the ACP initialize request: invalid params"
        ));
        assert!(!broken_install(""));
    }

    #[test]
    fn broken_install_summary_picks_the_signature_line_from_a_stack_trace() {
        let codex = "Codex process has exited with code 1:\n\
             Error: Missing optional dependency @openai/codex-darwin-arm64. \
             Reinstall Codex: npm install -g @openai/codex@latest\n\
             \x20   at Module._resolveFilename (node:internal/modules/cjs/loader:1234:15)\n\
             \x20   at Module._load (node:internal/modules/cjs/loader:567:12)";
        assert_eq!(
            broken_install_summary(codex).as_deref(),
            Some(
                "Error: Missing optional dependency @openai/codex-darwin-arm64. \
                 Reinstall Codex: npm install -g @openai/codex@latest"
            )
        );
    }

    #[test]
    fn only_npm_installs_are_reinstallable() {
        assert!(can_reinstall(
            Some(PackageManager::Npm),
            Some("@openai/codex")
        ));
        // Missing agent with an npm package will be installed via npm.
        assert!(can_reinstall(None, Some("@openai/codex")));
        // Missing brew-only agent has no npm reinstall.
        assert!(!can_reinstall(None, None));
        assert!(!can_reinstall(
            Some(PackageManager::Homebrew),
            Some("@openai/codex")
        ));
        assert!(!can_reinstall(
            Some(PackageManager::Bun),
            Some("opencode-ai")
        ));
        assert!(!can_reinstall(
            Some(PackageManager::Pnpm),
            Some("opencode-ai")
        ));
        // Self-managed (unrecognised path) is not reinstallable.
        assert!(!can_reinstall(
            Some(PackageManager::Unknown),
            Some("opencode-ai")
        ));
    }

    #[test]
    fn npm_install_and_update_include_optional_dependencies() {
        assert_eq!(
            install_command(agent("claude")).unwrap(),
            "npm install -g @agentclientprotocol/claude-agent-acp@latest --include=optional"
        );
        assert_eq!(
            update_command(
                agent("claude"),
                Some("/opt/homebrew/lib/node_modules/x/cli.js")
            )
            .unwrap(),
            "npm install -g @agentclientprotocol/claude-agent-acp@latest --include=optional"
        );
    }

    #[test]
    fn npm_extras_come_before_the_optional_flag() {
        assert_eq!(
            install_command(agent("pi")).unwrap(),
            "npm install -g pi-acp@latest @earendil-works/pi-coding-agent@latest --include=optional"
        );
    }

    #[test]
    fn bun_and_pnpm_commands_are_unchanged() {
        assert_eq!(
            update_command(agent("claude"), Some("/home/u/.bun/bin/claude-agent-acp")).unwrap(),
            "bun add -g @agentclientprotocol/claude-agent-acp@latest"
        );
        assert_eq!(
            update_command(
                agent("claude"),
                Some("/home/u/.local/share/pnpm/claude-agent-acp")
            )
            .unwrap(),
            "pnpm add -g @agentclientprotocol/claude-agent-acp@latest"
        );
        assert_eq!(
            install_command(agent("goose")).unwrap(),
            "brew install block-goose-cli"
        );
    }

    #[test]
    fn clean_reinstall_removes_then_installs_with_optional_dependencies() {
        assert_eq!(
            clean_install_command(agent("codex")).unwrap(),
            "npm uninstall -g @agentclientprotocol/codex-acp && \
             npm install -g @agentclientprotocol/codex-acp@latest --include=optional"
        );
        assert_eq!(clean_install_command(agent("goose")), None);
    }
}
