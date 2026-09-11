use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use crate::mcp::agents::ensure_owned;
use crate::mcp::daemon_client::DaemonClient;

pub(super) async fn dispatch(
    name: &str,
    client: &mut DaemonClient,
    parent_task: &str,
    project: &str,
    args: &Value,
) -> Result<String> {
    match name {
        "spawn_workflow" => {
            let workflow_id = args
                .get("workflow_id")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("'workflow_id' is required"))?;
            let goal = args
                .get("goal")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("'goal' is required"))?;
            let agent = args
                .get("agent")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("'agent' is required"))?;
            let result = client
                .request(
                    "task.create",
                    json!({
                        "project": project,
                        "prompt": goal,
                        "agent": agent,
                        "tags": ["orchestrator", "workflow-subagent"],
                        "include_runtime_context": true,
                        "worktree": false,
                        "parent_task_id": parent_task,
                        "workflow": workflow_id,
                    }),
                )
                .await?;
            let child = result
                .get("taskId")
                .and_then(Value::as_str)
                .unwrap_or("(unknown)");
            Ok(format!(
                "Dispatched workflow '{workflow_id}' as task {child}. It runs asynchronously \
                 through its own plan/implement/review/fix stages; you will be notified when \
                 its result is waiting — then call read_inbox. Check list_agents for its \
                 progress and whether it needs an answer (answer_workflow) or a decision \
                 (decide_workflow)."
            ))
        }
        "pause_workflow" => {
            let task_id = args
                .get("task_id")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("'task_id' is required"))?;
            ensure_owned(client, parent_task, project, args, task_id).await?;
            client
                .request("workflow.pause", json!({ "task": task_id }))
                .await?;
            Ok(format!(
                "Paused workflow pipeline {task_id} at its next stage boundary."
            ))
        }
        "resume_workflow" => {
            let task_id = args
                .get("task_id")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("'task_id' is required"))?;
            ensure_owned(client, parent_task, project, args, task_id).await?;
            let note = args.get("note").and_then(Value::as_str);
            client
                .request("workflow.resume", json!({ "task": task_id, "note": note }))
                .await?;
            Ok(format!("Resumed workflow pipeline {task_id}."))
        }
        "answer_workflow" => {
            let task_id = args
                .get("task_id")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("'task_id' is required"))?;
            let message = args
                .get("message")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("'message' is required"))?;
            ensure_owned(client, parent_task, project, args, task_id).await?;
            client
                .request(
                    "workflow.reply",
                    json!({ "task": task_id, "message": message }),
                )
                .await?;
            Ok(format!(
                "Answer sent to workflow pipeline {task_id}. It runs asynchronously; you will \
                 be notified when its result is waiting — then call read_inbox."
            ))
        }
        "decide_workflow" => {
            let task_id = args
                .get("task_id")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("'task_id' is required"))?;
            let decision = args
                .get("decision")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("'decision' is required"))?;
            if !["extend", "finish", "stop"].contains(&decision) {
                return Err(anyhow!("'decision' must be one of: extend, finish, stop"));
            }
            let rounds = match args.get("rounds") {
                None | Some(Value::Null) => None,
                Some(value) => Some(
                    value
                        .as_u64()
                        .ok_or_else(|| anyhow!("'rounds' must be an integer"))?,
                ),
            };
            let note = args.get("note").and_then(Value::as_str);
            ensure_owned(client, parent_task, project, args, task_id).await?;
            client
                .request(
                    "workflow.decide",
                    json!({
                        "task": task_id,
                        "decision": decision,
                        "rounds": rounds,
                        "note": note,
                    }),
                )
                .await?;
            Ok(format!(
                "Decision '{decision}' applied to workflow pipeline {task_id}."
            ))
        }
        other => Err(anyhow!("unknown tool: {other}")),
    }
}
