//! WebSocket server exposing the daemon over the `warpforge-protocol` wire
//! format. One `tokio-tungstenite` connection per client; every client is equal
//! (no "primary" UI). Frames:
//!
//! - first client frame: `{ "auth": "<token>" }` (skipped when the token is
//!   empty, i.e. `--dev`);
//! - then request/response: `{ "id", "method", "params" }` → `{ "id", "result" }`
//!   or `{ "id", "error" }`;
//! - after `state.subscribe`: the daemon pushes a `state.snapshot` event and
//!   then streams incremental events.
//!
//! The request dispatcher lives in [`dispatch`] as one exhaustive `match`; the
//! per-method bodies are split by topic under `dispatch/`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::Result;
use futures::{SinkExt, StreamExt};
use serde_json::json;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio::sync::{mpsc, Notify, RwLock, Semaphore};
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;
use warpforge_protocol as wire;

use super::actor::DaemonHandle;
use super::wire as wireconv;

use method_policy::{method_is_mutation, method_runs_concurrently};

mod client_hub;
mod dispatch;
mod endpoint;
mod fs_watch;
mod method_policy;
mod origin;
#[cfg(unix)]
mod stdio;
#[cfg(test)]
mod tests;
mod util;

#[cfg(test)]
pub(crate) use client_hub::HubConnection;
pub(crate) use client_hub::{ClientHub, ClientRequestError};
use dispatch::dispatch;
#[cfg(test)]
pub(crate) use dispatch::dispatch_detached;
use endpoint::{remove_endpoint, write_endpoint};
use origin::OriginPolicy;

/// Outgoing frames buffered per connection before the read loop slows down.
/// Shrunk under test so a regression test can fill it without sending
/// hundreds of events.
const OUTGOING_QUEUE: usize = if cfg!(test) { 4 } else { 256 };

/// Requests one connection may have in flight at once. Concurrent requests
/// answer off the read loop, so without a cap a client could fan out unbounded
/// git, filesystem and subprocess work by sending faster than the daemon
/// completes it.
const MAX_CONCURRENT_REQUESTS: usize = 8;

/// Bind, publish the endpoint, and serve forever. `dev` disables the auth token
/// so a browser (vite dev, no Tauri) can connect to a known address; the
/// Origin check still refuses every page but the app and the Vite server.
pub async fn serve(handle: DaemonHandle, dev: bool, owner: wire::DaemonOwner) -> Result<()> {
    // No boot-time orphan sweep. It used to `lsof`-kill every listener in every
    // project's range to clear orphans from a previous daemon crash, but a
    // range scan cannot tell a warpforge orphan from a process warpforge never
    // started — and a pinned range deliberately holds such processes (ADR 0006
    // invariant 3, which covers startup cleanup too). Orphan cleanup may only
    // return allocation-scoped: persisted service allocations read at startup,
    // the startup analogue of `ports::allocated_in_ranges`. Until that exists,
    // a crashed daemon's orphans are cleaned by stopping the project's
    // services normally, or by hand.

    #[cfg(unix)]
    {
        stdio::detach_stdin();
        stdio::detach_output();
    }

    let bind = if dev {
        "127.0.0.1:61814"
    } else {
        "127.0.0.1:0"
    };
    let listener = TcpListener::bind(bind).await?;
    let addr = listener.local_addr()?;
    let token = if dev {
        String::new()
    } else {
        Uuid::new_v4().to_string()
    };
    write_endpoint(addr, &token, owner)?;
    eprintln!("warpforge daemon listening on ws://{addr}");

    let lifecycle = Arc::new(ServerLifecycle {
        origins: OriginPolicy::new(dev),
        ..ServerLifecycle::new(owner)
    });

    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm = signal(SignalKind::terminate())?;
        let mut sigint = signal(SignalKind::interrupt())?;
        tokio::select! {
            r = run_controlled(listener, handle.clone(), token, Arc::clone(&lifecycle)) => {
                handle.shutdown().await;
                remove_endpoint();
                r
            },
            _ = sigterm.recv() => {
                eprintln!("warpforge daemon: SIGTERM — stopping services");
                handle.shutdown().await;
                remove_endpoint();
                Ok(())
            }
            _ = sigint.recv() => {
                eprintln!("warpforge daemon: SIGINT — stopping services");
                handle.shutdown().await;
                remove_endpoint();
                Ok(())
            }
        }
    }
    #[cfg(not(unix))]
    {
        let result = run_controlled(listener, handle.clone(), token, lifecycle).await;
        handle.shutdown().await;
        remove_endpoint();
        result
    }
}

struct ServerLifecycle {
    owner: wire::DaemonOwner,
    quiescing: AtomicBool,
    /// Serializes the safety snapshot against mutations arriving on other
    /// WebSocket connections. Mutations hold a read guard until their daemon
    /// command has been accepted; the update handoff takes the write guard
    /// before it flips `quiescing` and asks the actor for blockers.
    mutations: RwLock<()>,
    shutdown: Notify,
    origins: OriginPolicy,
    clients: ClientHub,
    browser_grants: crate::daemon::browser::Grants,
}

impl ServerLifecycle {
    fn new(owner: wire::DaemonOwner) -> Self {
        Self {
            owner,
            quiescing: AtomicBool::new(false),
            mutations: RwLock::new(()),
            shutdown: Notify::new(),
            origins: OriginPolicy::new(false),
            clients: ClientHub::default(),
            browser_grants: Default::default(),
        }
    }
}

/// Accept loop, split out so tests can drive it against a pre-bound listener.
pub async fn run(listener: TcpListener, handle: DaemonHandle, token: String) -> Result<()> {
    run_controlled(
        listener,
        handle,
        token,
        Arc::new(ServerLifecycle::new(wire::DaemonOwner::External)),
    )
    .await
}

async fn run_controlled(
    listener: TcpListener,
    handle: DaemonHandle,
    token: String,
    lifecycle: Arc<ServerLifecycle>,
) -> Result<()> {
    loop {
        let (stream, _) = tokio::select! {
            accepted = listener.accept() => accepted?,
            _ = lifecycle.shutdown.notified() => return Ok(()),
        };
        // Replies are small frames. Left to Nagle they wait on an ACK for the
        // previous one, which pairs with the peer's delayed ACK to add tens of
        // milliseconds to an otherwise instant answer.
        let _ = stream.set_nodelay(true);
        let handle = handle.clone();
        let token = token.clone();
        let lifecycle = Arc::clone(&lifecycle);
        tokio::spawn(async move {
            if let Err(e) = handle_conn(stream, handle, token, lifecycle).await {
                eprintln!("warpforge: connection ended: {e}");
            }
        });
    }
}

/// Aborts the wrapped task when dropped, so every exit path out of
/// `handle_conn` tears the events task down instead of leaking it.
struct AbortOnDrop(tokio::task::JoinHandle<()>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

// The Origin callback's error type is fixed by tungstenite's `Callback`.
#[allow(clippy::result_large_err)]
async fn handle_conn(
    stream: TcpStream,
    handle: DaemonHandle,
    token: String,
    lifecycle: Arc<ServerLifecycle>,
) -> Result<()> {
    let ws = tokio_tungstenite::accept_hdr_async(stream, |request: &_, response| {
        lifecycle.origins.check(request, response)
    })
    .await?;
    let (mut sink, mut rx) = ws.split();
    let mut authed = token.is_empty();
    let subscribed = Arc::new(AtomicBool::new(false));

    // Replies and events share one writer but travel on separate bounded
    // queues, and the writer drains replies first. A client that stops reading
    // fills the event queue; without the split a reply queued behind up to
    // `OUTGOING_QUEUE` events waited for all of them (editor file loads hung
    // while a task streamed output). Serial replies now backpressure only on
    // the reply queue.
    let (resp_tx, mut resp_rx) = mpsc::channel::<Message>(OUTGOING_QUEUE);
    let (event_tx, mut event_rx) = mpsc::channel::<Message>(OUTGOING_QUEUE);
    tokio::spawn(async move {
        loop {
            tokio::select! {
                biased;
                Some(msg) = resp_rx.recv() => {
                    if sink.send(msg).await.is_err() {
                        break;
                    }
                }
                Some(msg) = event_rx.recv() => {
                    if sink.send(msg).await.is_err() {
                        break;
                    }
                }
                else => break,
            }
        }
    });

    // Broadcast events are consumed on their own task that owns a clone of
    // the event sender. A client that stops reading its socket can fill the
    // event queue and park this task in `send`, but it can no longer park the
    // read loop below — which is what used to freeze request handling (a push
    // dialog's `git.pushInfo` was never even read while events drained). The
    // task exits when the connection closes (the guard aborts it) or `send`
    // fails.
    // Held for its drop guard: aborting the events task on every exit path.
    let _events_task = AbortOnDrop({
        let mut events = handle.subscribe();
        let handle = handle.clone();
        let out = event_tx.clone();
        let subscribed = Arc::clone(&subscribed);
        tokio::spawn(async move {
            // At most one resync snapshot queued at a time, so a sustained
            // flood cannot queue a snapshot per lag notice.
            let mut resync_queued = false;
            loop {
                let event = events.recv().await;
                match event {
                    Ok(ev) => {
                        if !subscribed.load(Ordering::Acquire) {
                            continue;
                        }
                        let Some(w) = wireconv::to_wire(&ev) else {
                            continue;
                        };
                        let message = wire::ServerMessage::Event(w);
                        let Ok(text) = serde_json::to_string(&message) else {
                            continue;
                        };
                        resync_queued = false;
                        if out.send(Message::Text(text)).await.is_err() {
                            return;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        // Never leak state to a client that has not subscribed
                        // (the task runs before auth), and do not pile up
                        // resyncs: drop notices while one is queued.
                        if !subscribed.load(Ordering::Acquire) || resync_queued {
                            continue;
                        }
                        let snapshot = handle.snapshot().await;
                        let message = wire::ServerMessage::Event(wire::Event::Snapshot(snapshot));
                        let Ok(text) = serde_json::to_string(&message) else {
                            continue;
                        };
                        resync_queued = true;
                        if out.send(Message::Text(text)).await.is_err() {
                            return;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => return,
                }
            }
        })
    });
    let hub_connection = lifecycle.clients.connection();
    let fs_watches = fs_watch::FsWatches::new();
    // Caps the work one client can have in flight at once.
    let request_slots = Arc::new(Semaphore::new(MAX_CONCURRENT_REQUESTS));

    macro_rules! send {
        ($msg:expr) => {{
            let text = serde_json::to_string(&$msg)?;
            if resp_tx.send(Message::Text(text)).await.is_err() {
                break;
            }
        }};
    }

    loop {
        tokio::select! {
            incoming = rx.next() => {
                let msg = match incoming {
                    Some(Ok(m)) => m,
                    _ => break,
                };
                let text = match msg {
                    Message::Text(t) => t.as_str().to_string(),
                    Message::Ping(p) => { let _ = resp_tx.send(Message::Pong(p)).await; continue; }
                    Message::Close(_) => break,
                    _ => continue,
                };

                if !authed {
                    let ok = serde_json::from_str::<serde_json::Value>(&text)
                        .ok()
                        .and_then(|v| v.get("auth").and_then(|a| a.as_str()).map(str::to_string))
                        .map(|got| got == token)
                        .unwrap_or(false);
                    if ok {
                        authed = true;
                    } else {
                        let _ = resp_tx.send(Message::Close(None)).await;
                        break;
                    }
                    continue;
                }

                let mut req: wire::Request = match serde_json::from_str(&text) {
                    Ok(r) => r,
                    Err(error) => {
                        // A frame that carries a request id but fails to parse
                        // (unknown method, params that don't match the variant)
                        // must still be answered: dropping it silently leaves
                        // the caller's promise pending forever, which surfaces
                        // as a spinner that never stops.
                        if let Some(id) = serde_json::from_str::<serde_json::Value>(&text)
                            .ok()
                            .and_then(|v| v.get("id").and_then(serde_json::Value::as_u64))
                        {
                            send!(wire::ServerMessage::Error {
                                id,
                                error: wire::RpcError {
                                    code: wire::ErrorCode::InvalidRequest,
                                    message: format!("unrecognized request: {error}"),
                                },
                            });
                        }
                        continue;
                    }
                };
                let id = req.id;

                if let Some(reply) = hub_connection.intercept(id, &mut req.method, &event_tx) {
                    send!(reply);
                    continue;
                }
                if let Some(reply) = fs_watches.intercept(&handle, id, &req.method).await {
                    send!(reply);
                    continue;
                }

                if matches!(req.method, wire::Method::StateSubscribe { .. }) {
                    let snapshot = handle.snapshot().await;
                    send!(wire::ServerMessage::Response { id, result: json!(null) });
                    send!(wire::ServerMessage::Event(wire::Event::Snapshot(snapshot)));
                    subscribed.store(true, Ordering::Release);
                    continue;
                }

                // Independent requests answer without holding up the next one.
                // Until now a connection served one request at a time, so a
                // tool approval was not even read off the socket while a title
                // was being generated ahead of it (ADR 0002).
                if method_runs_concurrently(&req.method) {
                    let gated = method_is_mutation(&req.method);
                    let handle = handle.clone();
                    let lifecycle = Arc::clone(&lifecycle);
                    let out = resp_tx.clone();
                    let slots = Arc::clone(&request_slots);
                    tokio::spawn(async move {
                        let _permit = slots.acquire_owned().await;
                        // The same update gate the serial path applies, kept
                        // here so moving a method between the two lists cannot
                        // quietly let it run during a daemon handover.
                        let result = if gated {
                            let _guard = lifecycle.mutations.read().await;
                            if lifecycle.quiescing.load(Ordering::Acquire) {
                                Err(wire::RpcError {
                                    code: wire::ErrorCode::Updating,
                                    message: "daemon is quiescing for an application update".into(),
                                })
                            } else {
                                dispatch(&handle, req.method, &lifecycle).await
                            }
                        } else {
                            dispatch(&handle, req.method, &lifecycle).await
                        };
                        let message = match result {
                            Ok(result) => wire::ServerMessage::Response { id, result },
                            Err(error) => wire::ServerMessage::Error { id, error },
                        };
                        if let Ok(text) = serde_json::to_string(&message) {
                            let _ = out.send(Message::Text(text)).await;
                        }
                    });
                    continue;
                }

                let is_handoff = matches!(&req.method, wire::Method::UpdatePrepareShutdown { .. });
                let is_quit = matches!(&req.method, wire::Method::AppQuit {});
                let result = if method_is_mutation(&req.method) && !is_handoff {
                    let _guard = lifecycle.mutations.read().await;
                    if lifecycle.quiescing.load(Ordering::Acquire) {
                        Err(wire::RpcError {
                            code: wire::ErrorCode::Updating,
                            message: "daemon is quiescing for an application update".into(),
                        })
                    } else {
                        dispatch(&handle, req.method, &lifecycle).await
                    }
                } else {
                    dispatch(&handle, req.method, &lifecycle).await
                };

                // A successful handoff or quit ends the accept loop, but only
                // after the reply is on the socket — the client is waiting for
                // it, and a refused handoff must leave the daemon serving.
                let stop_after_reply = if is_handoff {
                    matches!(
                        &result,
                        Ok(value) if value.get("ready").and_then(|ready| ready.as_bool()) == Some(true)
                    )
                } else {
                    is_quit && result.is_ok()
                };
                let message = match result {
                    Ok(result) => wire::ServerMessage::Response { id, result },
                    Err(error) => wire::ServerMessage::Error { id, error },
                };
                let text = serde_json::to_string(&message)?;
                let sent = resp_tx.send(Message::Text(text)).await.is_ok();

                if stop_after_reply {
                    // Queue the acknowledgement on the socket before stopping
                    // the accept loop. Even if the client disconnects at this
                    // point, the daemon must not remain stuck quiescing.
                    lifecycle.shutdown.notify_one();
                }
                if !sent {
                    break;
                }
            }
        }
    }
    Ok(())
}
