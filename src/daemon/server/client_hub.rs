//! Daemon → client requests: which connection answers one, and waiting for it.
//!
//! A connection offers capabilities with `client.register`; a request for a
//! capability goes to the newest connection that offered it, as a
//! `client.request` event on that connection alone. The answer is that
//! connection's `client.reply`. See `docs/adr/0021`.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;
use warpforge_protocol as wire;

type ConnId = u64;

/// Why a client request produced no result.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ClientRequestError {
    /// No connected client registered the capability.
    NoClient,
    /// The chosen client disconnected before it answered.
    Disconnected,
    /// The chosen client did not answer in time.
    TimedOut,
    /// The client answered with an error.
    Failed(String),
}

#[derive(Default)]
pub(crate) struct ClientHub {
    state: Mutex<HubState>,
}

#[derive(Default)]
struct HubState {
    next_conn: ConnId,
    /// In registration order; the last one with a capability answers for it.
    responders: Vec<Responder>,
    pending: HashMap<String, Pending>,
}

struct Responder {
    conn: ConnId,
    capabilities: Vec<String>,
    events: mpsc::Sender<Message>,
}

struct Pending {
    conn: ConnId,
    events: mpsc::Sender<Message>,
    reply: oneshot::Sender<Result<Value, String>>,
}

impl ClientHub {
    /// Track one WebSocket connection until the returned guard drops.
    /// @returns the connection's handle; dropping it withdraws its
    ///   registration and fails the requests it had not answered
    pub(crate) fn connection(&self) -> HubConnection<'_> {
        let mut state = self.state.lock().unwrap();
        state.next_conn += 1;
        HubConnection {
            hub: self,
            id: state.next_conn,
        }
    }

    /// Send `body` to the newest client that registered its capability and
    /// wait for the answer.
    /// @param body the work to request
    /// @param timeout how long the client has to answer
    /// @returns the client's result, or why there is none
    pub(crate) async fn request(
        &self,
        body: wire::ClientRequestBody,
        timeout: Duration,
    ) -> Result<Value, ClientRequestError> {
        let request_id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        let events = {
            let mut state = self.state.lock().unwrap();
            let capability = body.capability();
            let Some(responder) = state
                .responders
                .iter()
                .rev()
                .find(|r| r.capabilities.iter().any(|c| c == capability))
            else {
                return Err(ClientRequestError::NoClient);
            };
            let (conn, events) = (responder.conn, responder.events.clone());
            state.pending.insert(
                request_id.clone(),
                Pending {
                    conn,
                    events: events.clone(),
                    reply: tx,
                },
            );
            events
        };
        let _cancel_unless_answered = CancelOnDrop {
            hub: self,
            request_id: request_id.clone(),
        };
        let frame = wire::ServerMessage::Event(wire::Event::ClientRequest {
            request_id,
            timeout_ms: timeout.as_millis() as u64,
            body,
        });
        let text = serde_json::to_string(&frame)
            .map_err(|e| ClientRequestError::Failed(format!("encoding the request: {e}")))?;
        let exchange = async {
            if events.send(Message::Text(text)).await.is_err() {
                return Err(ClientRequestError::Disconnected);
            }
            match rx.await {
                Ok(Ok(value)) => Ok(value),
                Ok(Err(message)) => Err(ClientRequestError::Failed(message)),
                Err(_) => Err(ClientRequestError::Disconnected),
            }
        };
        tokio::time::timeout(timeout, exchange)
            .await
            .unwrap_or(Err(ClientRequestError::TimedOut))
    }

    fn register(&self, conn: ConnId, capabilities: Vec<String>, events: mpsc::Sender<Message>) {
        let mut state = self.state.lock().unwrap();
        state.responders.retain(|r| r.conn != conn);
        if !capabilities.is_empty() {
            state.responders.push(Responder {
                conn,
                capabilities,
                events,
            });
        }
    }

    fn reply(
        &self,
        conn: ConnId,
        request_id: &str,
        answer: Result<Value, String>,
    ) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        match state.pending.get(request_id) {
            Some(pending) if pending.conn == conn => {}
            Some(_) => return Err("this request was sent to another client".into()),
            None => return Err("no such request: it was answered, cancelled or timed out".into()),
        }
        let pending = state.pending.remove(request_id).expect("checked above");
        let _ = pending.reply.send(answer);
        Ok(())
    }

    fn disconnect(&self, conn: ConnId) {
        let mut state = self.state.lock().unwrap();
        state.responders.retain(|r| r.conn != conn);
        // Dropping the reply senders wakes each waiter with `Disconnected`.
        state.pending.retain(|_, pending| pending.conn != conn);
    }
}

/// Withdraws a request its waiter stopped waiting for — timed out or dropped —
/// and tells the client so it can stop working on it.
struct CancelOnDrop<'a> {
    hub: &'a ClientHub,
    request_id: String,
}

impl Drop for CancelOnDrop<'_> {
    fn drop(&mut self) {
        let Some(pending) = self
            .hub
            .state
            .lock()
            .unwrap()
            .pending
            .remove(&self.request_id)
        else {
            return;
        };
        let frame = wire::ServerMessage::Event(wire::Event::ClientRequestCancelled {
            request_id: self.request_id.clone(),
        });
        if let Ok(text) = serde_json::to_string(&frame) {
            let _ = pending.events.try_send(Message::Text(text));
        }
    }
}

/// One connection's view of the hub, alive as long as the connection.
pub(crate) struct HubConnection<'a> {
    hub: &'a ClientHub,
    id: ConnId,
}

impl HubConnection<'_> {
    /// Answer the requests that concern the connection itself rather than the
    /// daemon: registering, and replying to a request sent to it.
    /// @param id the request's id
    /// @param method the request; a reply's result is taken out of it
    /// @param events the connection's event queue
    /// @returns the response to send, or `None` for any other method
    pub(crate) fn intercept(
        &self,
        id: u64,
        method: &mut wire::Method,
        events: &mpsc::Sender<Message>,
    ) -> Option<wire::ServerMessage> {
        let outcome = match method {
            wire::Method::ClientRegister { capabilities } => {
                self.hub
                    .register(self.id, std::mem::take(capabilities), events.clone());
                Ok(json!({}))
            }
            wire::Method::ClientReply {
                request_id,
                result,
                error,
            } => {
                let answer = match error.take() {
                    Some(message) => Err(message),
                    None => Ok(result.take().unwrap_or(Value::Null)),
                };
                self.hub
                    .reply(self.id, request_id, answer)
                    .map(|()| json!({}))
            }
            _ => return None,
        };
        Some(match outcome {
            Ok(result) => wire::ServerMessage::Response { id, result },
            Err(message) => wire::ServerMessage::Error {
                id,
                error: wire::RpcError {
                    code: wire::ErrorCode::NotFound,
                    message,
                },
            },
        })
    }
}

impl Drop for HubConnection<'_> {
    fn drop(&mut self) {
        self.hub.disconnect(self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body() -> wire::ClientRequestBody {
        wire::ClientRequestBody::Browser {
            project: "demo".into(),
            action: wire::BrowserAction::Snapshot {
                interactive: false,
                scope: None,
                headings: false,
            },
            allowed_origins: vec![],
        }
    }

    fn register(conn: &HubConnection<'_>, capabilities: &[&str]) -> mpsc::Receiver<Message> {
        let (tx, rx) = mpsc::channel(8);
        let mut method = wire::Method::ClientRegister {
            capabilities: capabilities.iter().map(|c| c.to_string()).collect(),
        };
        let reply = conn.intercept(1, &mut method, &tx);
        assert!(matches!(reply, Some(wire::ServerMessage::Response { .. })));
        rx
    }

    fn event(message: Message) -> wire::Event {
        let Message::Text(text) = message else {
            panic!("not text")
        };
        match serde_json::from_str(&text).unwrap() {
            wire::ServerMessage::Event(event) => event,
            other => panic!("not an event: {other:?}"),
        }
    }

    fn reply_method(request_id: &str, result: Value) -> wire::Method {
        wire::Method::ClientReply {
            request_id: request_id.into(),
            result: Some(result),
            error: None,
        }
    }

    #[tokio::test]
    async fn nobody_registered_is_an_immediate_error() {
        let hub = ClientHub::default();
        let _other = hub.connection();
        let result = hub.request(body(), Duration::from_secs(5)).await;
        assert_eq!(result, Err(ClientRequestError::NoClient));
    }

    #[tokio::test]
    async fn the_newest_registration_answers_and_only_it_may_reply() {
        let hub = ClientHub::default();
        let old = hub.connection();
        let new = hub.connection();
        let mut old_rx = register(&old, &["browser"]);
        let mut new_rx = register(&new, &["browser"]);

        let request = hub.request(body(), Duration::from_secs(5));
        let answer = async {
            let wire::Event::ClientRequest { request_id, .. } = event(new_rx.recv().await.unwrap())
            else {
                panic!("expected a request")
            };
            let (tx, _rx) = mpsc::channel(1);
            let refused = old.intercept(2, &mut reply_method(&request_id, json!(1)), &tx);
            assert!(matches!(refused, Some(wire::ServerMessage::Error { .. })));
            new.intercept(
                3,
                &mut reply_method(&request_id, json!({ "ok": true })),
                &tx,
            )
        };
        let (result, accepted) = tokio::join!(request, answer);
        assert_eq!(result, Ok(json!({ "ok": true })));
        assert!(matches!(
            accepted,
            Some(wire::ServerMessage::Response { .. })
        ));
        assert!(old_rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn a_client_that_disconnects_fails_its_requests_and_the_next_newest_is_asked() {
        let hub = ClientHub::default();
        let first = hub.connection();
        let mut first_rx = register(&first, &["browser"]);
        let second = hub.connection();
        let mut second_rx = register(&second, &["browser"]);

        let request = hub.request(body(), Duration::from_secs(5));
        let drop_it = async {
            second_rx.recv().await.unwrap();
            drop(second);
        };
        let (result, ()) = tokio::join!(request, drop_it);
        assert_eq!(result, Err(ClientRequestError::Disconnected));

        let fallback = hub.request(body(), Duration::from_millis(50)).await;
        assert_eq!(fallback, Err(ClientRequestError::TimedOut));
        assert!(matches!(
            event(first_rx.try_recv().unwrap()),
            wire::Event::ClientRequest { .. }
        ));
    }

    #[tokio::test]
    async fn a_timeout_cancels_the_request_and_refuses_a_late_reply() {
        let hub = ClientHub::default();
        let conn = hub.connection();
        let mut rx = register(&conn, &["browser"]);

        let result = hub.request(body(), Duration::from_millis(20)).await;
        assert_eq!(result, Err(ClientRequestError::TimedOut));

        let wire::Event::ClientRequest { request_id, .. } = event(rx.recv().await.unwrap()) else {
            panic!("expected a request")
        };
        assert_eq!(
            event(rx.recv().await.unwrap()),
            wire::Event::ClientRequestCancelled {
                request_id: request_id.clone()
            }
        );
        let (tx, _rx) = mpsc::channel(1);
        let late = conn.intercept(4, &mut reply_method(&request_id, json!(1)), &tx);
        assert!(matches!(late, Some(wire::ServerMessage::Error { .. })));
    }

    #[tokio::test]
    async fn an_error_reply_reaches_the_caller_and_other_methods_pass_through() {
        let hub = ClientHub::default();
        let conn = hub.connection();
        let mut rx = register(&conn, &["browser"]);

        let request = hub.request(body(), Duration::from_secs(5));
        let answer = async {
            let wire::Event::ClientRequest { request_id, .. } = event(rx.recv().await.unwrap())
            else {
                panic!("expected a request")
            };
            let (tx, _rx) = mpsc::channel(1);
            let mut method = wire::Method::ClientReply {
                request_id,
                result: None,
                error: Some("no page is open".into()),
            };
            conn.intercept(5, &mut method, &tx);
        };
        let (result, ()) = tokio::join!(request, answer);
        assert_eq!(
            result,
            Err(ClientRequestError::Failed("no page is open".into()))
        );

        let (tx, _rx) = mpsc::channel(1);
        let mut other = wire::Method::AgentsList {};
        assert!(conn.intercept(6, &mut other, &tx).is_none());
    }
}
