use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use crate::mcp::agents::{
    agent_values, list_owned_agents, model_ids, render_agents_listing, validate_model,
    ACTIVE_AGENT_STATUSES, DEFAULT_CLEANUP_MAX_AGE_SECONDS, INACTIVE_AGENT_STATUSES,
};
use crate::mcp::daemon_client::DaemonClient;
use crate::mcp::format::{json_text, now_secs, scoped_project};

pub(super) async fn dispatch(
    name: &str,
    client: &mut DaemonClient,
    parent_task: &str,
    project: &str,
    args: &Value,
) -> Result<String> {
    match name {
        "list_agent_models" => {
            let filter_agent = args
                .get("agent")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.to_string());
            let result = client.request("agents.list", json!({})).await?;
            let agents = result
                .get("agents")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let enabled: Vec<&Value> = agents
                .iter()
                .filter(|a| a.get("enabled").and_then(Value::as_bool).unwrap_or(true))
                .collect();
            if let Some(ref fa) = filter_agent {
                let Some(entry) = enabled
                    .iter()
                    .find(|a| a.get("id").and_then(Value::as_str) == Some(fa))
                else {
                    return Err(anyhow!("unknown agent '{fa}'"));
                };
                let models = entry
                    .get("models")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                // Ids only — the id is what spawn_agent takes, and labels are
                // mostly a re-cased restatement of it (openrouter lists 368).
                let ids = model_ids(&models);
                if ids.is_empty() {
                    return Ok(format!("agent {fa}: no cached model list"));
                }
                return Ok(format!(
                    "agent {fa} ({} models):\n{}",
                    ids.len(),
                    ids.join("\n")
                ));
            }
            // no filter: compact index
            let mut out = String::new();
            for a in &enabled {
                let id = a.get("id").and_then(Value::as_str).unwrap_or("?");
                let models = a
                    .get("models")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let cnt = model_ids(&models).len();
                out.push_str(&format!("{id}: {cnt} models\n"));
            }
            out.push_str("call list_agent_models with agent=\"<id>\" for ids");
            Ok(out)
        }
        "spawn_agent" => {
            let agent = args
                .get("agent")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("'agent' is required"))?;
            let task = args
                .get("task")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("'task' is required"))?;
            let model = args
                .get("model")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .map(str::to_string);
            let mut unvalidated = false;
            if let Some(ref m) = model {
                let agents_res = client.request("agents.list", json!({})).await?;
                if let Some(arr) = agents_res.get("agents").and_then(Value::as_array) {
                    if let Some(entry) = arr
                        .iter()
                        .find(|a| a.get("id").and_then(Value::as_str) == Some(agent))
                    {
                        let opts = entry
                            .get("models")
                            .and_then(Value::as_array)
                            .cloned()
                            .unwrap_or_default();
                        let valid = model_ids(&opts);
                        if valid.is_empty() {
                            unvalidated = true;
                        } else {
                            validate_model(&opts, m, agent)?;
                        }
                    } else {
                        unvalidated = true;
                    }
                }
            }
            let mut params = json!({
                "project": project,
                "prompt": task,
                "agent": agent,
                "tags": ["orchestrator", "subagent"],
                "include_runtime_context": true,
                "worktree": false,
                "parent_task_id": parent_task,
            });
            if let Some(ref m) = model {
                params["default_model"] = json!(m);
            }
            let result = client.request("task.create", params).await?;
            let child = result
                .get("taskId")
                .and_then(Value::as_str)
                .unwrap_or("(unknown)");
            if unvalidated {
                Ok(format!(
                    "Dispatched sub-agent '{agent}' as task {child} (model '{m}' could not be validated — no cached model list for this agent). It runs asynchronously; you will be notified when its result is waiting — then call read_inbox.",
                    m = model.as_deref().unwrap_or("")
                ))
            } else {
                Ok(format!(
                    "Dispatched sub-agent '{agent}' as task {child}. It runs asynchronously; \
                     you will be notified when its result is waiting — then call read_inbox."
                ))
            }
        }
        "read_inbox" => {
            let result = client
                .request(
                    "orchestrator.readInbox",
                    json!({ "parent_task_id": parent_task }),
                )
                .await?;
            let results = result
                .get("results")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if results.is_empty() {
                return Ok("Inbox empty — no sub-agent results waiting.".into());
            }
            let mut out = String::new();
            for r in &results {
                let agent = r.get("agent").and_then(Value::as_str).unwrap_or("?");
                let child = r.get("childId").and_then(Value::as_str).unwrap_or("?");
                let ok = r.get("success").and_then(Value::as_bool).unwrap_or(false);
                let prompt = r.get("prompt").and_then(Value::as_str).unwrap_or("");
                let output = r.get("output").and_then(Value::as_str).unwrap_or("");
                let status = if ok { "completed" } else { "FAILED" };
                out.push_str(&format!(
                    "── sub-agent {agent} (task {child}) {status}\n\
                     Task: {prompt}\n\
                     Result:\n{output}\n\n"
                ));
            }
            Ok(out)
        }
        "message_agent" => {
            let task_id = args
                .get("task_id")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("'task_id' is required"))?;
            let message = args
                .get("message")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("'message' is required"))?;
            client
                .request(
                    "session.prompt",
                    json!({
                        "task_id": task_id,
                        "text": message,
                    }),
                )
                .await?;
            Ok(format!(
                "Message sent to sub-agent task {task_id}. It runs asynchronously; \
                 you will be notified when its result is waiting — then call read_inbox."
            ))
        }
        "list_agents" => {
            let scoped = scoped_project(args, project)?;
            let result = list_owned_agents(client, parent_task, scoped.as_deref()).await?;
            let agents = agent_values(&result)?;
            Ok(render_agents_listing(&agents))
        }
        "stop_agent" => {
            let task_id = args
                .get("task_id")
                .and_then(Value::as_str)
                .filter(|id| !id.trim().is_empty())
                .ok_or_else(|| anyhow!("'task_id' is required"))?;
            let scoped = scoped_project(args, project)?;
            let result = list_owned_agents(client, parent_task, scoped.as_deref()).await?;
            let agents = agent_values(&result)?;
            let Some(agent) = agents
                .iter()
                .find(|agent| agent.get("id").and_then(Value::as_str) == Some(task_id))
            else {
                return Err(anyhow!(
                    "task {task_id} is not a sub-agent owned by this orchestrator"
                ));
            };

            client
                .request("task.cancel", json!({ "task_id": task_id }))
                .await?;
            json_text(&json!({
                "taskId": task_id,
                "stopped": true,
                "task": agent,
            }))
        }
        "cleanup_agents" => {
            let max_age_seconds = match args.get("max_age_seconds") {
                None | Some(Value::Null) => DEFAULT_CLEANUP_MAX_AGE_SECONDS,
                Some(value) => value
                    .as_u64()
                    .ok_or_else(|| anyhow!("'max_age_seconds' must be a non-negative integer"))?,
            };
            let dry_run = match args.get("dry_run") {
                None | Some(Value::Null) => false,
                Some(value) => value
                    .as_bool()
                    .ok_or_else(|| anyhow!("'dry_run' must be a boolean"))?,
            };
            let include_active = match args.get("include_active") {
                None | Some(Value::Null) => false,
                Some(value) => value
                    .as_bool()
                    .ok_or_else(|| anyhow!("'include_active' must be a boolean"))?,
            };
            let scoped = scoped_project(args, project)?;
            let result = list_owned_agents(client, parent_task, scoped.as_deref()).await?;
            let agents = agent_values(&result)?;
            let now = now_secs();
            let mut selected = Vec::new();
            let mut skipped = Vec::new();

            for agent in agents {
                let task_id = agent.get("id").and_then(Value::as_str).unwrap_or("");
                let status = agent.get("status").and_then(Value::as_str).unwrap_or("");
                let updated_at = agent
                    .get("updatedAt")
                    .and_then(Value::as_u64)
                    .or_else(|| agent.get("createdAt").and_then(Value::as_u64));
                let Some(updated_at) = updated_at else {
                    skipped.push(json!({
                        "taskId": task_id,
                        "status": status,
                        "reason": "missing_timestamp",
                    }));
                    continue;
                };
                let age_seconds = now.saturating_sub(updated_at);

                let eligible_status = INACTIVE_AGENT_STATUSES.contains(&status)
                    || (include_active && ACTIVE_AGENT_STATUSES.contains(&status));
                if !eligible_status {
                    let reason = if ACTIVE_AGENT_STATUSES.contains(&status) {
                        "active"
                    } else {
                        "unknown_status"
                    };
                    skipped.push(json!({
                        "taskId": task_id,
                        "status": status,
                        "ageSeconds": age_seconds,
                        "reason": reason,
                    }));
                    continue;
                }
                if age_seconds < max_age_seconds {
                    skipped.push(json!({
                        "taskId": task_id,
                        "status": status,
                        "ageSeconds": age_seconds,
                        "reason": "too_new",
                    }));
                    continue;
                }

                selected.push(json!({
                    "taskId": task_id,
                    "status": status,
                    "ageSeconds": age_seconds,
                }));
            }

            let mut deleted = Vec::new();
            let mut errors = Vec::new();
            if !dry_run {
                for candidate in &selected {
                    let Some(task_id) = candidate.get("taskId").and_then(Value::as_str) else {
                        errors.push(json!({
                            "task": candidate,
                            "error": "candidate has no task id",
                        }));
                        continue;
                    };
                    if let Err(error) = client
                        .request("task.cancel", json!({ "task_id": task_id }))
                        .await
                    {
                        errors.push(json!({
                            "taskId": task_id,
                            "phase": "stop",
                            "error": error.to_string(),
                        }));
                        continue;
                    }
                    match client
                        .request("task.delete", json!({ "task_id": task_id }))
                        .await
                    {
                        Ok(_) => deleted.push(candidate.clone()),
                        Err(error) => errors.push(json!({
                            "taskId": task_id,
                            "phase": "delete",
                            "error": error.to_string(),
                        })),
                    }
                }
            }

            json_text(&json!({
                "parentTaskId": parent_task,
                "project": scoped,
                "maxAgeSeconds": max_age_seconds,
                "dryRun": dry_run,
                "includeActive": include_active,
                "selected": selected,
                "deleted": deleted,
                "skipped": skipped,
                "errors": errors,
            }))
        }
        other => Err(anyhow!("unknown tool: {other}")),
    }
}
