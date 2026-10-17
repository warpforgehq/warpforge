//! The peer tools (ADR 0026): `list_agents` and `message_agent` for every
//! session, children first for an orchestrator, and `set_status_note`. The
//! daemon resolves who a message goes to; nothing here decides it.

use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use warpforge_protocol as wire;

use crate::mcp::agents::{agent_values, list_owned_agents, render_agents_listing};
use crate::mcp::daemon_client::DaemonClient;
use crate::mcp::format::scoped_project;

pub(super) async fn dispatch(
    name: &str,
    client: &mut DaemonClient,
    caller: &str,
    project: &str,
    is_orchestrator: bool,
    args: &Value,
) -> Result<String> {
    if caller.is_empty() {
        return Err(anyhow!("this session is not bound to a task"));
    }
    match name {
        "list_agents" => {
            let mut out = String::new();
            if is_orchestrator {
                let scoped = scoped_project(args, project)?;
                let result = list_owned_agents(client, caller, scoped.as_deref()).await?;
                out.push_str("## Sub-agents (relation: child)\n\n");
                out.push_str(&render_agents_listing(&agent_values(&result)?));
                out.push_str("\n\n");
            }
            let result = client
                .request("peers.list", json!({ "task_id": caller }))
                .await?;
            let peers: Vec<wire::PeerInfo> =
                serde_json::from_value(result.get("peers").cloned().unwrap_or_default())?;
            out.push_str("## Peers (relation: peer)\n\n");
            out.push_str(&render_peers(&peers));
            Ok(out)
        }
        "message_agent" => {
            let to = required(args, "task_id")?;
            let message = required(args, "message")?;
            let result = client
                .request(
                    "session.message",
                    json!({ "from_task_id": caller, "to": to, "message": message }),
                )
                .await?;
            let sent: wire::PeerSendResult = serde_json::from_value(result)?;
            Ok(sent_text(to, &sent))
        }
        "set_status_note" => {
            let text = args
                .get("text")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("'text' is required"))?;
            client
                .request(
                    "peers.setStatusNote",
                    json!({ "task_id": caller, "text": text }),
                )
                .await?;
            Ok(if text.trim().is_empty() {
                "Status note cleared.".into()
            } else {
                "Status note set; peers see it in list_agents.".into()
            })
        }
        other => Err(anyhow!("unknown tool: {other}")),
    }
}

fn required<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("'{key}' is required"))
}

/// Table cells hold one line, and `|` would end the cell.
fn cell(value: &str) -> String {
    value.replace(['\n', '\r'], " ").replace('|', "/")
}

fn render_peers(peers: &[wire::PeerInfo]) -> String {
    if peers.is_empty() {
        return "No other Warpforge sessions are working in this project.".into();
    }
    let mut out = String::from("| id | session | agent | status | note |\n");
    out.push_str("| --- | --- | --- | --- | --- |\n");
    for peer in peers {
        let mut status = serde_json::to_value(peer.status)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_default();
        if peer.snoozed {
            status.push_str(", snoozed");
        }
        if peer.orchestrator {
            status.push_str(", orchestrator");
        }
        out.push_str(&format!(
            "| {} | {} | {} | {} | {} |\n",
            peer.id,
            cell(&wire::peer_label(peer)),
            cell(&peer.agent),
            status,
            cell(peer.note.as_deref().unwrap_or("")),
        ));
    }
    out
}

fn sent_text(to: &str, sent: &wire::PeerSendResult) -> String {
    let label = sent.to_label.as_deref().unwrap_or(to);
    match sent.relation {
        wire::PeerRelation::Child => format!(
            "Message sent to sub-agent task {to}. It runs asynchronously; you will be \
             notified when its result is waiting — then call read_inbox."
        ),
        wire::PeerRelation::Team => {
            "Posted to the team channel. Nobody is woken; each peer reads it with its next prompt."
                .into()
        }
        wire::PeerRelation::Peer => match &sent.notice {
            Some(notice) => notice.clone(),
            None => format!(
                "Message sent to {label} ({to}). It arrives as their next turn; if they \
                 answer, it reaches you as a message from them."
            ),
        },
    }
}
