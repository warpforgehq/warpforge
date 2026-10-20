mod agent;
mod bootstrap;
mod config;
mod config_local;
mod daemon;
mod mcp;
#[allow(dead_code)]
mod orchestration;
#[allow(dead_code)]
mod policies;
mod portforward;
mod ports;
mod registry;
mod service;
#[cfg(unix)]
mod signal;
mod workflow_config;
mod worktree_config;

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "warpforge",
    about = "Workspace orchestrator with embedded agent terminals",
    arg_required_else_help = true
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Run the daemon: owns all state, serves the local WebSocket API for
    /// clients (desktop app). Publishes ~/.warpforge/daemon.json.
    Daemon {
        /// Bind a fixed local port with no auth token, so a browser (vite dev,
        /// no Tauri) can connect. For development only.
        #[arg(long)]
        dev: bool,
        /// Marks a daemon bundled and launched by the desktop application.
        /// Only such a daemon accepts an in-app update handoff.
        #[arg(long, value_enum, default_value_t = DaemonOwnerArg::External)]
        owner: DaemonOwnerArg,
    },
    /// (internal) MCP server bridging an orchestrator agent to the daemon.
    /// Spawned by the daemon via an orchestrator session's mcpServers config,
    /// not meant to be run by hand.
    #[command(name = "__mcp-orchestrator", hide = true)]
    McpOrchestrator,
}

#[derive(Clone, Copy, clap::ValueEnum)]
enum DaemonOwnerArg {
    Desktop,
    External,
}

impl From<DaemonOwnerArg> for warpforge_protocol::DaemonOwner {
    fn from(value: DaemonOwnerArg) -> Self {
        match value {
            DaemonOwnerArg::Desktop => Self::Desktop,
            DaemonOwnerArg::External => Self::External,
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Daemon { dev, owner } => {
            mcp::identity::forget_inherited_session();
            let projects = registry::list_projects().unwrap_or_default();
            let store = daemon::Store::open().ok();
            let handle = daemon::Daemon::spawn(projects, store);
            daemon::server::serve(handle, dev, owner.into()).await?;
        }
        Commands::McpOrchestrator => {
            mcp::run().await?;
        }
    }

    Ok(())
}
