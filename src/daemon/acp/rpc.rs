use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot, watch};

use super::process::{ChildExit, ChildState};

pub(super) type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;

/// Send a request and await its response (resolved by the reader task).
pub(super) async fn rpc(
    out_tx: &mpsc::UnboundedSender<String>,
    pending: &Pending,
    next_id: &Arc<AtomicU64>,
    method: &str,
    params: Value,
) -> Option<Value> {
    let id = next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = oneshot::channel();
    pending.lock().unwrap().insert(id, tx);
    if out_tx
        .send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string())
        .is_err()
    {
        return None;
    }
    rx.await.ok()
}

pub(super) enum RpcOutcome {
    Response(Value),
    Exited(ChildExit),
    TransportClosed,
}

/// Send an RPC while observing a durable child-exit state. If stdout closes,
/// wait for the process monitor so callers receive the real exit status rather
/// than racing a consumed channel notification.
pub(super) async fn rpc_with_exit(
    out_tx: &mpsc::UnboundedSender<String>,
    pending: &Pending,
    next_id: &Arc<AtomicU64>,
    method: &str,
    params: Value,
    exit_rx: &mut watch::Receiver<ChildState>,
) -> RpcOutcome {
    if let ChildState::Exited(exit) = exit_rx.borrow().clone() {
        return RpcOutcome::Exited(exit);
    }
    let id = next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = oneshot::channel();
    pending.lock().unwrap().insert(id, tx);
    if out_tx
        .send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string())
        .is_err()
    {
        return wait_for_exit_with_grace(exit_rx).await;
    }
    tokio::select! {
        result = rx => match result {
            Ok(value) => RpcOutcome::Response(value),
            Err(_) => wait_for_exit_with_grace(exit_rx).await,
        },
        _ = exit_rx.changed() => {
            let state = exit_rx.borrow().clone();
            match state {
                ChildState::Exited(exit) => RpcOutcome::Exited(exit),
                ChildState::Running => wait_for_exit(exit_rx).await,
            }
        }
    }
}

pub(super) async fn wait_for_exit_with_grace(
    exit_rx: &mut watch::Receiver<ChildState>,
) -> RpcOutcome {
    tokio::time::timeout(
        std::time::Duration::from_millis(250),
        wait_for_exit(exit_rx),
    )
    .await
    .unwrap_or(RpcOutcome::TransportClosed)
}

pub(super) async fn wait_for_exit(exit_rx: &mut watch::Receiver<ChildState>) -> RpcOutcome {
    loop {
        if let ChildState::Exited(exit) = exit_rx.borrow().clone() {
            return RpcOutcome::Exited(exit);
        }
        if exit_rx.changed().await.is_err() {
            return RpcOutcome::Exited(ChildExit {
                code: None,
                status: "process monitor closed".into(),
            });
        }
    }
}

pub(super) fn compact_id(id: &Value) -> String {
    // Numbers -> "5", strings -> the string, everything else -> JSON text.
    id.as_u64()
        .map(|n| n.to_string())
        .or_else(|| id.as_str().map(String::from))
        .unwrap_or_else(|| id.to_string())
}

pub(super) fn resolve(cwd: &str, path: &str) -> PathBuf {
    let p = Path::new(path);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        Path::new(cwd).join(p)
    }
}
