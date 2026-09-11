use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use crate::mcp::agents::{ensure_portforward, ensure_service};
use crate::mcp::daemon_client::DaemonClient;
use crate::mcp::format::{json_text, scoped_project};
use crate::mcp::logs::read_logs;

pub(super) async fn dispatch(
    name: &str,
    client: &mut DaemonClient,
    project: &str,
    args: &Value,
) -> Result<String> {
    match name {
        "list_runtime" => {
            let scoped = scoped_project(args, project)?;
            let Some(project) = scoped else {
                return Err(anyhow!("a project is required to list the runtime"));
            };
            let result = client
                .request("runtime.list", json!({ "project": project }))
                .await?;
            json_text(&result)
        }
        "read_service_logs" => {
            let scoped = scoped_project(args, project)?;
            let Some(project) = scoped else {
                return Err(anyhow!("a project is required to read service logs"));
            };
            let service = args
                .get("service")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow!("'service' is required"))?;
            read_logs(
                client,
                "service.logs",
                &project,
                "service",
                "service",
                service,
                args,
            )
            .await
        }
        "read_portforward_logs" => {
            let scoped = scoped_project(args, project)?;
            let Some(project) = scoped else {
                return Err(anyhow!("a project is required to read port-forward logs"));
            };
            let name = args
                .get("name")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow!("'name' is required"))?;
            read_logs(
                client,
                "portforward.logs",
                &project,
                "portforward",
                "name",
                name,
                args,
            )
            .await
        }
        "service_start" | "service_stop" | "service_restart" => {
            let scoped = scoped_project(args, project)?;
            let Some(project) = scoped else {
                return Err(anyhow!("a project is required to control a service"));
            };
            let service = args
                .get("service")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow!("'service' is required"))?;
            ensure_service(client, &project, service).await?;
            let method = match name {
                "service_start" => "service.start",
                "service_stop" => "service.stop",
                _ => "service.restart",
            };
            client
                .request(method, json!({ "project": project, "service": service }))
                .await?;
            Ok(format!(
                "{method} dispatched for '{service}' in project '{project}'. \
                 It runs asynchronously — read read_service_logs to follow its progress."
            ))
        }
        "portforward_start" | "portforward_stop" => {
            let scoped = scoped_project(args, project)?;
            let Some(project) = scoped else {
                return Err(anyhow!("a project is required to control a port-forward"));
            };
            let pf_name = args
                .get("name")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow!("'name' is required"))?;
            ensure_portforward(client, &project, pf_name).await?;
            let method = match name {
                "portforward_start" => "portforward.start",
                _ => "portforward.stop",
            };
            client
                .request(method, json!({ "project": project, "name": pf_name }))
                .await?;
            Ok(format!(
                "{method} dispatched for '{pf_name}' in project '{project}'."
            ))
        }
        other => Err(anyhow!("unknown tool: {other}")),
    }
}
