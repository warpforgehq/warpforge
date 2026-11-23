use std::time::Duration;

use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use crate::mcp::daemon_client::DaemonClient;

pub(crate) mod action;
mod render;
#[cfg(test)]
mod tests;

use action::action_for;
use render::render;

/// Long enough for the user to answer an approval prompt (the daemon gives
/// them five minutes) and for the page to act after it.
const BROWSER_TIMEOUT: Duration = Duration::from_secs(360);

pub(crate) fn is_browser_tool(name: &str) -> bool {
    matches!(
        name,
        "browser_snapshot"
            | "browser_click"
            | "browser_type"
            | "browser_press"
            | "browser_scroll"
            | "browser_wait"
            | "browser_navigate"
            | "browser_screenshot"
            | "browser_console"
    )
}

pub(super) async fn dispatch(
    name: &str,
    client: &mut DaemonClient,
    task: &str,
    project: &str,
    args: &Value,
) -> Result<Vec<Value>> {
    if project.is_empty() {
        return Err(anyhow!(
            "the browser tools need a session bound to a project"
        ));
    }
    let action = action_for(name, args)?;
    let result = client
        .request_within(
            "browser.act",
            json!({ "project": project, "task_id": task, "action": action }),
            BROWSER_TIMEOUT,
        )
        .await?;
    Ok(render(&action, &result))
}
