use anyhow::{anyhow, Context, Result};
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

pub(crate) type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Read the published daemon endpoint, connect, and authenticate.
async fn connect_daemon() -> Result<WsStream> {
    let path = dirs::home_dir()
        .unwrap_or_default()
        .join(".warpforge")
        .join("daemon.json");
    let raw = std::fs::read_to_string(&path)
        .with_context(|| format!("reading {} — is the daemon running?", path.display()))?;
    let endpoint: Value = serde_json::from_str(&raw)?;
    let url = endpoint
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("daemon.json missing url"))?;
    let token = endpoint.get("token").and_then(|v| v.as_str()).unwrap_or("");

    let (mut ws, _) = tokio_tungstenite::connect_async(url)
        .await
        .with_context(|| format!("connecting to daemon at {url}"))?;
    if !token.is_empty() {
        ws.send(Message::Text(json!({ "auth": token }).to_string()))
            .await?;
    }
    Ok(ws)
}

/// A minimal request/response client over the daemon WebSocket. Tool calls are
/// serialized (one stdin request at a time), so a simple send-then-read-until-
/// matching-id loop is sufficient — we never subscribe, so no event stream.
/// The connection is established lazily and re-established if it drops.
pub(crate) struct DaemonClient {
    pub(crate) ws: Option<WsStream>,
    pub(crate) next_id: u64,
}

impl DaemonClient {
    pub(crate) async fn request(&mut self, method: &str, params: Value) -> Result<Value> {
        if self.ws.is_none() {
            self.ws = Some(connect_daemon().await?);
        }
        match self.request_inner(method, params).await {
            Ok(v) => Ok(v),
            Err(e) => {
                // Drop a broken connection so the next call reconnects.
                self.ws = None;
                Err(e)
            }
        }
    }

    async fn request_inner(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        let ws = self
            .ws
            .as_mut()
            .ok_or_else(|| anyhow!("no daemon connection"))?;
        let frame = json!({ "id": id, "method": method, "params": params });
        ws.send(Message::Text(frame.to_string())).await?;

        while let Some(msg) = ws.next().await {
            let text = match msg? {
                Message::Text(t) => t.to_string(),
                Message::Ping(p) => {
                    ws.send(Message::Pong(p)).await?;
                    continue;
                }
                Message::Close(_) => return Err(anyhow!("daemon closed the connection")),
                _ => continue,
            };
            let Ok(v) = serde_json::from_str::<Value>(&text) else {
                continue;
            };
            if v.get("id").and_then(Value::as_u64) != Some(id) {
                continue; // an event or a stale reply — ignore
            }
            if let Some(err) = v.get("error") {
                return Err(anyhow!("daemon error: {err}"));
            }
            return Ok(v.get("result").cloned().unwrap_or(Value::Null));
        }
        Err(anyhow!("daemon connection ended before replying"))
    }
}
