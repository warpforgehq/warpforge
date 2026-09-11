use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tokio::process::Command;
use tokio::sync::{mpsc, watch};

use crate::daemon::accounts::AgentEnv;
use crate::daemon::prompt::PreparedPrompt;

use super::process::{
    capture_pre_initialize_stderr, child_exit_message, kill_process_group, sanitize_stderr,
    ChildExit, ChildState, FailureReporter, ProcessGuard, STDERR_TOTAL_BYTES,
};
use super::{AcpHandle, AcpUpdate, PolicyCheck};

mod init;
mod permissions;
mod reader;
mod turn;
mod writer;

#[cfg(test)]
pub(super) use permissions::parse_permission;

struct Session {
    task_id: String,
    command: String,
    cwd: String,
    initial_prompt: PreparedPrompt,
    resume: Option<String>,
    mcp_servers: Vec<Value>,
    updates: mpsc::UnboundedSender<(String, AcpUpdate)>,
    out_tx: mpsc::UnboundedSender<String>,
    pending: super::rpc::Pending,
    perms: Arc<Mutex<HashMap<String, permissions::PendingPerm>>>,
    next_id: Arc<AtomicU64>,
    replaying: Arc<AtomicBool>,
    image_capability: Arc<AtomicU8>,
    initialized: Arc<AtomicBool>,
    kill_tx: mpsc::UnboundedSender<()>,
    reporter: FailureReporter,
    stderr_capture: Arc<Mutex<Vec<u8>>>,
    exit_rx: watch::Receiver<ChildState>,
    permission_run_id: String,
    default_model: Option<String>,
    config_overrides: HashMap<String, String>,
}

impl Clone for Session {
    fn clone(&self) -> Self {
        Self {
            task_id: self.task_id.clone(),
            command: self.command.clone(),
            cwd: self.cwd.clone(),
            initial_prompt: self.initial_prompt.clone(),
            resume: self.resume.clone(),
            mcp_servers: self.mcp_servers.clone(),
            updates: self.updates.clone(),
            out_tx: self.out_tx.clone(),
            pending: Arc::clone(&self.pending),
            perms: Arc::clone(&self.perms),
            next_id: Arc::clone(&self.next_id),
            replaying: Arc::clone(&self.replaying),
            image_capability: Arc::clone(&self.image_capability),
            initialized: Arc::clone(&self.initialized),
            kill_tx: self.kill_tx.clone(),
            reporter: self.reporter.clone(),
            stderr_capture: Arc::clone(&self.stderr_capture),
            exit_rx: self.exit_rx.clone(),
            permission_run_id: self.permission_run_id.clone(),
            default_model: self.default_model.clone(),
            config_overrides: self.config_overrides.clone(),
        }
    }
}

static NEXT_RUN_ID: AtomicU64 = AtomicU64::new(1);

/// Spawn an agent process and its ACP session. Returns immediately; the
/// `initialize` → `session/new` → initial `session/prompt` handshake runs in
/// the background and streams updates over `updates`.
///
/// When `policy_tx` is provided, file write operations are gated through the
/// daemon's policy engine before execution.
#[allow(clippy::too_many_arguments)]
pub fn spawn_acp_session(
    task_id: String,
    command: String,
    cwd: String,
    initial_prompt: PreparedPrompt,
    // When set, resume this native session id via ACP `session/load` instead of
    // starting a fresh `session/new`. The agent replays history as updates.
    resume: Option<String>,
    // MCP servers to advertise to the agent on session setup (empty for a plain
    // task; the orchestrator session passes the warpforge MCP bridge here).
    mcp_servers: Vec<Value>,
    updates: mpsc::UnboundedSender<(String, AcpUpdate)>,
    policy_tx: Option<mpsc::UnboundedSender<PolicyCheck>>,
    // Model id to apply to the session before the first prompt — fresh
    // `session/new` and, when set, resume too. None = no override: a fresh
    // session keeps the agent default and a resumed one keeps its own state.
    default_model: Option<String>,
    // Non-model config overrides (reasoning effort, mode, etc.) keyed by
    // config-option id; applied via `session/setConfigOption` after model.
    config_overrides: HashMap<String, String>,
    // Environment changes for the agent process, layered over the daemon's own:
    // the selected account's home to set, and inherited auth variables to drop.
    env: AgentEnv,
) -> anyhow::Result<AcpHandle> {
    let run_id = NEXT_RUN_ID.fetch_add(1, Ordering::Relaxed);
    let mut child_command = Command::new("sh");
    child_command
        .args(["-c", &command])
        .current_dir(&cwd)
        .envs(env.set);
    for key in env.remove {
        child_command.env_remove(key);
    }
    child_command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    child_command.process_group(0);
    let mut child = child_command.spawn()?;

    let stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let initialized = Arc::new(AtomicBool::new(false));
    let stderr_capture = Arc::new(Mutex::new(Vec::with_capacity(STDERR_TOTAL_BYTES)));
    let mut stderr_task = tokio::spawn(capture_pre_initialize_stderr(
        stderr,
        Arc::clone(&initialized),
        Arc::clone(&stderr_capture),
    ));

    let reporter = FailureReporter {
        task_id: task_id.clone(),
        run_id,
        updates: updates.clone(),
        reported: Arc::new(AtomicBool::new(false)),
    };
    let stopping = Arc::new(AtomicBool::new(false));
    let (kill_tx, mut kill_rx) = mpsc::unbounded_channel();
    let process = Arc::new(ProcessGuard {
        kill_tx,
        stopping: Arc::clone(&stopping),
    });
    let (exit_tx, exit_rx) = watch::channel(ChildState::Running);
    let pgid = child.id();
    {
        let reporter = reporter.clone();
        let command = command.clone();
        let monitor_stderr_capture = Arc::clone(&stderr_capture);
        tokio::spawn(async move {
            let status = tokio::select! {
                status = child.wait() => status,
                _ = kill_rx.recv() => {
                    kill_process_group(pgid).await;
                    let _ = child.start_kill();
                    child.wait().await
                }
            };
            kill_process_group(pgid).await;
            if tokio::time::timeout(std::time::Duration::from_millis(100), &mut stderr_task)
                .await
                .is_err()
            {
                stderr_task.abort();
            }
            let stderr = sanitize_stderr(&monitor_stderr_capture.lock().unwrap());
            let exit = match status {
                Ok(status) => ChildExit {
                    code: status.code(),
                    status: status.to_string(),
                },
                Err(error) => ChildExit {
                    code: None,
                    status: format!("wait failed: {error}"),
                },
            };
            exit_tx.send_replace(ChildState::Exited(exit.clone()));
            if !stopping.load(Ordering::Acquire) {
                reporter.report(child_exit_message(&command, &exit, &stderr));
            }
        });
    }

    let (out_tx, out_rx) = mpsc::unbounded_channel::<String>();
    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<super::AcpCommand>();
    let image_capability = Arc::new(AtomicU8::new(0));

    // Set WARPFORGE_ACP_DEBUG=1 to log the raw JSON-RPC exchange to the daemon's
    // stderr — the fastest way to see why a real agent isn't answering.
    let debug = std::env::var("WARPFORGE_ACP_DEBUG").is_ok();

    writer::spawn_writer(task_id.clone(), stdin, out_rx, debug);

    let pending: super::rpc::Pending = Arc::new(Mutex::new(HashMap::new()));
    let perms: Arc<Mutex<HashMap<String, permissions::PendingPerm>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let next_id = Arc::new(AtomicU64::new(1));
    // True only while a `session/load` RPC is in flight. During that window the
    // agent replays its entire transcript back as `session/update`
    // notifications; we already have that history persisted, so the reader
    // drops it instead of re-streaming (and re-persisting) it to clients as if
    // it were live — which used to flood the chat and blink task status on
    // every resume of an old session.
    let replaying = Arc::new(AtomicBool::new(false));
    let permission_run_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos().to_string())
        .unwrap_or_else(|_| "0".into());

    let session = Session {
        task_id,
        command,
        cwd,
        initial_prompt,
        resume,
        mcp_servers,
        updates,
        out_tx,
        pending,
        perms,
        next_id,
        replaying,
        image_capability: Arc::clone(&image_capability),
        initialized,
        kill_tx: process.kill_tx.clone(),
        reporter,
        stderr_capture,
        exit_rx: exit_rx.clone(),
        permission_run_id,
        default_model,
        config_overrides,
    };

    reader::spawn_reader(session.clone(), stdout, policy_tx, debug);

    // Driver: handshake, initial prompt, then the command loop.
    {
        let session = session.clone();
        tokio::spawn(async move {
            let agent_name = sanitize_stderr(session.command.trim().as_bytes());
            if let Ok(init) = init::handshake(&session, &agent_name).await {
                turn::run(&session, &agent_name, init, &mut cmd_rx).await;
            }
        });
    }

    Ok(AcpHandle {
        cmd_tx,
        exit_rx,
        image_capability,
        process,
        run_id,
    })
}
