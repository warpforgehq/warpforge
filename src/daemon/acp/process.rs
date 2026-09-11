use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::mpsc;
use warpforge_protocol as wire;

use super::AcpUpdate;

#[derive(Clone, Debug)]
pub(super) struct ChildExit {
    pub(super) code: Option<i32>,
    pub(super) status: String,
}

#[derive(Clone, Debug)]
pub(super) enum ChildState {
    Running,
    Exited(ChildExit),
}

pub(super) struct ProcessGuard {
    pub(super) kill_tx: mpsc::UnboundedSender<()>,
    pub(super) stopping: Arc<AtomicBool>,
}

impl ProcessGuard {
    pub(super) fn stop_intentionally(&self) {
        self.stopping.store(true, Ordering::Release);
        let _ = self.kill_tx.send(());
    }
}

impl Drop for ProcessGuard {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::Release);
        let _ = self.kill_tx.send(());
    }
}

#[derive(Clone)]
pub(super) struct FailureReporter {
    pub(super) task_id: String,
    pub(super) run_id: u64,
    pub(super) updates: mpsc::UnboundedSender<(String, AcpUpdate)>,
    pub(super) reported: Arc<AtomicBool>,
}

impl FailureReporter {
    pub(super) fn report(&self, message: String) {
        self.report_kind(message, None);
    }

    pub(super) fn report_kind(&self, message: String, kind: Option<wire::TaskBlockedKind>) {
        if self
            .reported
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            let _ = self.updates.send((
                self.task_id.clone(),
                AcpUpdate::Error {
                    run_id: self.run_id,
                    message,
                    kind,
                },
            ));
        }
    }
}

/// Whether a rejected `session/load` means the session is gone for good rather
/// than temporarily unavailable. Agents report it as JSON-RPC "resource not
/// found" — a durable answer, unlike a transport or startup failure, so the
/// client can stop offering resume and offer a fresh session instead.
///
/// The verdict discards the saved session id, so it has to be narrow. A bare
/// "not found" is not enough: a load can also fail because the *cwd* is gone,
/// which is recoverable and must keep the id. The message therefore has to name
/// the session we asked about.
pub(super) fn is_session_gone(response: &Value, session_id: &str) -> bool {
    let Some(err) = response.get("error") else {
        return false;
    };
    if err.get("code").and_then(Value::as_i64) == Some(-32002) {
        return true;
    }
    let message = err.get("message").and_then(Value::as_str).unwrap_or("");
    let names_session = message.contains(session_id)
        || err
            .get("data")
            .map(|data| data.to_string().contains(session_id))
            .unwrap_or(false);
    names_session && message.to_ascii_lowercase().contains("not found")
}

/// How long a caller waits for a killed ACP child to be reaped before giving
/// up. Bounded so a stuck child cannot stall the single-threaded daemon actor.
pub const STOP_GRACE: std::time::Duration = std::time::Duration::from_secs(10);
pub(super) const STDERR_LINE_BYTES: usize = 512;
pub(super) const STDERR_TOTAL_BYTES: usize = 4096;

/// Extract the JSON-RPC `error` from an agent response into a human-readable,
/// secret-redacted suffix (leading space included) for reporting. Empty string
/// when there is no error object. Surfaces the real reason (auth, bad cwd, …)
/// that would otherwise be swallowed by the generic "rejected" message.
pub(super) fn acp_error_detail(response: &Value) -> String {
    let Some(err) = response.get("error") else {
        return String::new();
    };
    let message = err
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("unknown error");
    let code = err.get("code").and_then(Value::as_i64);
    let data = err
        .get("data")
        .filter(|d| !d.is_null())
        .map(|d| d.to_string());
    let mut detail = match code {
        Some(code) => format!(" Agent error {code}: {message}"),
        None => format!(" Agent error: {message}"),
    };
    if let Some(data) = data {
        detail.push_str(&format!(" ({data})"));
    }
    bound_diagnostic(&redact_secrets(&detail))
}

pub(super) fn sanitize_stderr(input: &[u8]) -> String {
    let text = String::from_utf8_lossy(input);
    let clean: String = text
        .chars()
        .filter_map(|ch| match ch {
            '\n' | '\t' => Some(ch),
            ch if !ch.is_control() => Some(ch),
            _ => None,
        })
        .collect();
    bound_diagnostic(&redact_secrets(&clean))
}

pub(super) fn bound_diagnostic(input: &str) -> String {
    let mut output = String::new();
    let mut total_bytes = 0usize;
    for (index, line) in input.lines().enumerate() {
        if index > 0 && total_bytes < STDERR_TOTAL_BYTES {
            output.push('\n');
            total_bytes += 1;
        }
        let mut line_bytes = 0usize;
        for ch in line.chars() {
            let bytes = ch.len_utf8();
            if line_bytes + bytes > STDERR_LINE_BYTES || total_bytes + bytes > STDERR_TOTAL_BYTES {
                break;
            }
            output.push(ch);
            line_bytes += bytes;
            total_bytes += bytes;
        }
        if total_bytes >= STDERR_TOTAL_BYTES {
            break;
        }
    }
    output
}

pub(super) fn redact_secrets(input: &str) -> String {
    input
        .lines()
        .map(|line| {
            let lower = line.to_ascii_lowercase();
            if lower
                .split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '_')
                .any(|term| {
                    matches!(
                        term,
                        "auth"
                            | "token"
                            | "bearer"
                            | "authorization"
                            | "auth_token"
                            | "access_token"
                            | "api_token"
                            | "api_key"
                            | "apikey"
                    )
                })
            {
                "[REDACTED]".to_string()
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(super) fn append_stderr_chunk(captured: &mut Vec<u8>, line_bytes: &mut usize, chunk: &[u8]) {
    for &byte in chunk {
        if captured.len() >= STDERR_TOTAL_BYTES {
            return;
        }
        if byte == b'\n' {
            captured.push(byte);
            *line_bytes = 0;
        } else if *line_bytes < STDERR_LINE_BYTES {
            captured.push(byte);
            *line_bytes += 1;
        }
    }
}

pub(super) async fn capture_pre_initialize_stderr(
    mut stderr: tokio::process::ChildStderr,
    initialized: Arc<AtomicBool>,
    captured: Arc<Mutex<Vec<u8>>>,
) {
    let mut line_bytes = 0usize;
    let mut buf = [0u8; 256];
    while let Ok(n) = stderr.read(&mut buf).await {
        if n == 0 {
            break;
        }
        if initialized.load(Ordering::Acquire) {
            continue;
        }
        for &byte in &buf[..n] {
            if initialized.load(Ordering::Acquire) {
                break;
            }
            append_stderr_chunk(&mut captured.lock().unwrap(), &mut line_bytes, &[byte]);
        }
    }
}

pub(super) async fn kill_process_group(pgid: Option<u32>) {
    #[cfg(unix)]
    if let Some(pgid) = pgid {
        let _ = Command::new("kill")
            .args(["-KILL", "--", &format!("-{pgid}")])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
    }
    #[cfg(not(unix))]
    let _ = pgid;
}

pub(super) fn child_exit_message(command: &str, exit: &ChildExit, stderr: &str) -> String {
    let safe_command = sanitize_stderr(command.as_bytes());
    let detail = if stderr.trim().is_empty() {
        String::new()
    } else {
        format!(" Pre-initialize stderr: {}", stderr.trim())
    };
    format!(
        "Agent command '{safe_command}' exited \
         (status: {}; code: {:?}).{detail}",
        exit.status, exit.code
    )
}
