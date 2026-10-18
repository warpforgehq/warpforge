use std::panic::AssertUnwindSafe;

use anyhow::Result;
use futures::FutureExt;
use serde_json::{json, Value};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};

use super::daemon_client::DaemonClient;
use super::identity::BridgeMode;
use super::{
    advisor_tool_defs, browser_tool_defs, handle, smith_tool_defs, tool_defs, MCP_VERSION,
    READ_ONLY_TOOLS, THREAD_TOOLS,
};

/// The session a server's tools act for.
pub(crate) struct Session {
    pub(crate) parent_task: String,
    pub(crate) project: String,
    pub(crate) is_orchestrator: bool,
    pub(crate) mode: BridgeMode,
}

/// The MCP stdio loop: newline-delimited JSON-RPC 2.0 with the agent.
///
/// It ends only when `input` closes or a read or write fails. The agent cannot
/// restart the server, so nothing a request does may end it.
/// @param input the agent's messages, one per line
/// @param output where replies are written
/// @param client the daemon connection the tools use
/// @param session the session the tools act for
/// @returns `Ok` once `input` closes, or the read or write error
pub(crate) async fn serve<R, W>(
    mut input: R,
    mut output: W,
    client: &mut DaemonClient,
    session: &Session,
) -> Result<()>
where
    R: AsyncBufRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut line = Vec::new();
    loop {
        line.clear();
        if input.read_until(b'\n', &mut line).await? == 0 {
            return Ok(());
        }
        let Ok(message) = serde_json::from_slice::<Value>(&line) else {
            continue;
        };
        // Notifications (no id) and responses (no method) get no reply.
        let (Some(method), Some(id)) = (
            message.get("method").and_then(Value::as_str),
            message.get("id").cloned(),
        ) else {
            continue;
        };
        let reply = match method {
            "initialize" => Ok(json!({
                "protocolVersion": MCP_VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": {
                    "name": "warpforge",
                    "version": env!("CARGO_PKG_VERSION"),
                },
            })),
            "tools/list" => Ok(json!({ "tools": session_tools(session) })),
            "tools/call" => Ok(call_tool(client, session, message.get("params")).await),
            "ping" => Ok(json!({})),
            other => {
                Err(json!({ "code": -32601, "message": format!("method not found: {other}") }))
            }
        };
        let frame = match reply {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error }),
        };
        output.write_all(frame.to_string().as_bytes()).await?;
        output.write_all(b"\n").await?;
        output.flush().await?;
    }
}

/// @param name a warpforge tool
/// @returns whether a Smith's thread bridge serves it
pub(crate) fn thread_may_call(name: &str) -> bool {
    READ_ONLY_TOOLS.contains(&name) || THREAD_TOOLS.contains(&name)
}

fn session_tools(session: &Session) -> Value {
    let mut tools = tool_defs(session.is_orchestrator);
    let Value::Array(list) = &mut tools else {
        return tools;
    };
    match session.mode {
        BridgeMode::Advisor => {
            list.retain(|tool| {
                tool["name"]
                    .as_str()
                    .is_some_and(|name| READ_ONLY_TOOLS.contains(&name))
            });
            return tools;
        }
        BridgeMode::Thread => {
            list.extend(smith_tool_defs());
            list.retain(|tool| tool["name"].as_str().is_some_and(thread_may_call));
            return tools;
        }
        BridgeMode::Work | BridgeMode::SmithOrchestrator => list.extend(smith_tool_defs()),
        BridgeMode::Advised => list.extend(advisor_tool_defs()),
        BridgeMode::Single | BridgeMode::Orchestrator => {}
    }
    if !session.project.is_empty() {
        list.extend(browser_tool_defs());
    }
    tools
}

/// Route a call by the session's mode: an advisor gets the read-only tools
/// only, and `ask_advisor` exists only where the task has an advisor.
async fn session_call(
    client: &mut DaemonClient,
    session: &Session,
    params: Option<&Value>,
) -> anyhow::Result<Vec<Value>> {
    let name = params
        .and_then(|p| p.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if session.mode == BridgeMode::Advisor && !READ_ONLY_TOOLS.contains(&name) {
        anyhow::bail!("the advisor is read-only: '{name}' is not available to it");
    }
    if session.mode == BridgeMode::Thread && !thread_may_call(name) {
        anyhow::bail!("a Smith's thread does not change code: '{name}' is for a work session");
    }
    if name == "start_work" && !session.mode.may_start_work() {
        anyhow::bail!("start_work is for a Smith's own sessions");
    }
    if name == "ask_advisor" {
        if session.mode != BridgeMode::Advised {
            anyhow::bail!("this task has no advisor");
        }
        let args = params
            .and_then(|p| p.get("arguments"))
            .cloned()
            .unwrap_or_else(|| json!({}));
        let text = handle::ask_advisor(client, &session.parent_task, &args).await?;
        return Ok(vec![json!({ "type": "text", "text": text })]);
    }
    handle::tool_content(
        client,
        &session.parent_task,
        &session.project,
        session.is_orchestrator,
        params,
    )
    .await
}

async fn call_tool(client: &mut DaemonClient, session: &Session, params: Option<&Value>) -> Value {
    let call = session_call(client, session, params);
    let error = match AssertUnwindSafe(call).catch_unwind().await {
        Ok(Ok(content)) => return json!({ "content": content }),
        Ok(Err(error)) => format!("Error: {error:#}"),
        // The panic hook has already written the message to stderr.
        Err(_) => "Error: the tool crashed inside the warpforge MCP server".to_string(),
    };
    json!({ "content": [{ "type": "text", "text": error }], "isError": true })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::daemon_client::fake::FakeDaemon;

    async fn run(daemon: &FakeDaemon, is_orchestrator: bool, input: &[u8]) -> Vec<Value> {
        let mut client = DaemonClient::new(Box::new(daemon.clone()));
        let session = Session {
            parent_task: "t_orch".into(),
            project: "demo".into(),
            is_orchestrator,
            mode: if is_orchestrator {
                BridgeMode::Orchestrator
            } else {
                BridgeMode::Single
            },
        };
        let mut output = Vec::new();
        serve(input, &mut output, &mut client, &session)
            .await
            .expect("serve returns Ok at end of input");
        String::from_utf8(output)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    fn call(id: u64, tool: &str) -> String {
        json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call",
                "params": { "name": tool, "arguments": {} } })
        .to_string()
    }

    #[tokio::test]
    async fn a_daemon_that_is_down_is_a_tool_error_and_serving_goes_on() {
        let input = format!(
            "{}\n{}\n{}\n",
            call(1, "list_runtime"),
            json!({ "id": 2, "method": "tools/list" }),
            json!({ "id": 3, "method": "ping" }),
        );
        let replies = run(&FakeDaemon::default(), true, input.as_bytes()).await;

        assert_eq!(replies.len(), 3);
        assert_eq!(replies[0]["result"]["isError"], true);
        let text = replies[0]["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("daemon.json"), "{text}");
        let tools = replies[1]["result"]["tools"].as_array().unwrap();
        assert!(tools.iter().any(|tool| tool["name"] == "spawn_agent"));
        assert_eq!(
            replies[2],
            json!({ "jsonrpc": "2.0", "id": 3, "result": {} })
        );
    }

    #[tokio::test]
    async fn lines_that_are_not_utf8_or_not_json_are_skipped() {
        let mut input = b"\xff\xfe\x00garbage\n{not json\n\n".to_vec();
        input.extend_from_slice(json!({ "id": 1, "method": "ping" }).to_string().as_bytes());
        let replies = run(&FakeDaemon::default(), false, &input).await;

        assert_eq!(replies.len(), 1);
        assert_eq!(replies[0]["id"], 1);
    }

    #[tokio::test]
    async fn only_requests_are_answered_and_unknown_ones_get_method_not_found() {
        let input = format!(
            "{}\n{}\n{}\n",
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
            json!({ "jsonrpc": "2.0", "id": 9, "result": {} }),
            json!({ "jsonrpc": "2.0", "id": 4, "method": "resources/list" }),
        );
        let replies = run(&FakeDaemon::default(), false, input.as_bytes()).await;

        assert_eq!(replies.len(), 1);
        assert_eq!(replies[0]["id"], 4);
        assert_eq!(replies[0]["error"]["code"], -32601);
    }

    #[tokio::test]
    async fn a_tool_that_panics_is_a_tool_error_and_serving_goes_on() {
        let daemon = FakeDaemon::at("ws://a");
        daemon.state().panic_on_endpoint = true;
        let input = format!("{}\n{}\n", call(1, "list_runtime"), call(2, "spawn_agent"));
        let replies = run(&daemon, false, input.as_bytes()).await;

        assert_eq!(replies.len(), 2);
        assert_eq!(replies[0]["result"]["isError"], true);
        let text = replies[1]["result"]["content"][0]["text"].as_str().unwrap();
        assert!(
            text.contains("only available in an orchestrator session"),
            "{text}"
        );
    }

    #[test]
    fn browser_tools_are_listed_only_for_a_session_bound_to_a_project() {
        for (project, listed) in [("demo", true), ("", false)] {
            let session = Session {
                parent_task: "t_1".into(),
                project: project.into(),
                is_orchestrator: false,
                mode: BridgeMode::Single,
            };
            let tools = session_tools(&session);
            let names: Vec<&str> = tools
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|tool| tool["name"].as_str())
                .collect();
            assert_eq!(names.contains(&"browser_snapshot"), listed, "{project:?}");
            assert!(names.contains(&"list_runtime"));
        }
    }

    fn tool_names(mode: BridgeMode) -> Vec<String> {
        let session = Session {
            parent_task: "t_1".into(),
            project: "demo".into(),
            is_orchestrator: mode.is_orchestrator(),
            mode,
        };
        session_tools(&session)
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|tool| tool["name"].as_str().map(str::to_string))
            .collect()
    }

    #[test]
    fn ask_advisor_is_listed_only_where_the_task_has_an_advisor() {
        assert!(tool_names(BridgeMode::Advised).contains(&"ask_advisor".to_string()));
        assert!(!tool_names(BridgeMode::Single).contains(&"ask_advisor".to_string()));
        let advisor = tool_names(BridgeMode::Advisor);
        assert!(advisor
            .iter()
            .all(|name| READ_ONLY_TOOLS.contains(&name.as_str())));
        assert!(advisor.contains(&"read_service_logs".to_string()));
    }

    #[test]
    fn peer_tools_are_listed_in_every_working_session_but_never_for_an_advisor() {
        let peer_tools = ["list_agents", "message_agent", "set_status_note"];
        for mode in [
            BridgeMode::Single,
            BridgeMode::Advised,
            BridgeMode::Orchestrator,
        ] {
            let names = tool_names(mode);
            for tool in peer_tools {
                assert_eq!(
                    names.iter().filter(|name| *name == tool).count(),
                    1,
                    "{tool} once in {mode:?}"
                );
            }
        }
        let advisor = tool_names(BridgeMode::Advisor);
        assert!(peer_tools
            .iter()
            .all(|tool| !advisor.contains(&tool.to_string())));
        assert!(!tool_names(BridgeMode::Single).contains(&"stop_agent".to_string()));
    }

    #[test]
    fn a_smiths_thread_gets_read_only_tools_and_the_ones_it_coordinates_with() {
        let thread = tool_names(BridgeMode::Thread);
        for tool in [
            "list_agents",
            "message_agent",
            "memory_store",
            "create_backlog_task",
            "update_backlog_task",
            "start_work",
        ] {
            assert!(thread.contains(&tool.to_string()), "{tool}");
        }
        for tool in [
            "service_restart",
            "spawn_agent",
            "close_backlog_task",
            "ask_advisor",
        ] {
            assert!(!thread.contains(&tool.to_string()), "{tool}");
        }
        assert!(thread.iter().all(|name| thread_may_call(name)));
        assert!(tool_names(BridgeMode::Work).contains(&"start_work".to_string()));
        assert!(!tool_names(BridgeMode::Single).contains(&"start_work".to_string()));
    }

    #[test]
    fn an_orchestrator_run_as_a_smith_keeps_both_tool_sets() {
        let lead = tool_names(BridgeMode::SmithOrchestrator);
        let plain = tool_names(BridgeMode::Orchestrator);
        for tool in &plain {
            assert!(lead.contains(tool), "{tool} from the orchestrator set");
        }
        for tool in ["spawn_agent", "read_inbox", "spawn_workflow", "start_work"] {
            assert!(lead.contains(&tool.to_string()), "{tool}");
        }
        assert!(!plain.contains(&"start_work".to_string()));
        assert!(BridgeMode::SmithOrchestrator.may_start_work());
        assert!(!BridgeMode::Orchestrator.may_start_work());
    }

    #[tokio::test]
    async fn an_advisor_cannot_call_a_tool_that_changes_anything() {
        let mut client = DaemonClient::new(Box::new(FakeDaemon::at("ws://a")));
        let session = Session {
            parent_task: "t_adv".into(),
            project: "demo".into(),
            is_orchestrator: false,
            mode: BridgeMode::Advisor,
        };
        let mut output = Vec::new();
        let input = format!(
            "{}\n{}\n{}\n{}\n",
            call(1, "service_restart"),
            call(2, "ask_advisor"),
            call(3, "message_agent"),
            call(4, "set_status_note")
        );
        serve(input.as_bytes(), &mut output, &mut client, &session)
            .await
            .unwrap();
        let replies: Vec<Value> = String::from_utf8(output)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        for reply in &replies {
            assert_eq!(reply["result"]["isError"], true);
            let text = reply["result"]["content"][0]["text"].as_str().unwrap();
            assert!(text.contains("the advisor is read-only"), "{text}");
        }
    }

    #[tokio::test]
    async fn a_tool_call_reaches_the_daemon() {
        let input = call(1, "list_runtime");
        let replies = run(&FakeDaemon::at("ws://a"), false, input.as_bytes()).await;

        assert_eq!(replies[0]["result"]["isError"], Value::Null);
        let text = replies[0]["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("runtime.list"), "{text}");
    }
}
